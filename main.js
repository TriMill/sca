document.getElementById("apply").addEventListener("click", applyClicked);

// Enables debug mode
window.debug = false;
// Logs all sound changes
window.logChanges = false;
// Last rules (raw and parsed), used to skip rule parsing if rules weren't changed
window.lastRules = undefined;
window.lastPRules = undefined;

/*
 * This is called whenever the "Apply" button is pressed. It gathers the contents of each input element, parses the 
 * rules, and then applies the rules to the input words to generate the output.
 */
function applyClicked(event) {
	// Get data from each input element
	window.debug = document.getElementById("enable-debug").checked;
	window.logChanges = document.getElementById("log-changes").checked;
	let doNormalize = document.getElementById("normalize").checked;
	let outputStyle = document.getElementById("output-style").checked;
	let rules = document.getElementById("rules").value;
	let input = document.getElementById("input").value;
	let outputEl = document.getElementById("output");
	let errorEl = document.getElementById("errors");
	let initTime = new Date();
	log("Starting");

	// If normalize is checked, normalize rules and input
	if(doNormalize) {
		rules = rules.normalize()
		input = input.normalize()
	}
	// Rules: split on newlines and remove spaces
	rules = rules.split("\n").map(a => a.replace(/\s/g,"")).filter(a => a.length > 0);
	// Input: split on all spaces
	input = input.split(/\s/g).filter(a => a.length > 0);

	log(rules);
	log(input);
	
	let pRules = window.lastPRules;
	if(
		lastRules == undefined // first run
		|| rules.length != lastRules.length  // raw rule lists don't match in length
		|| !rules.every((val, index) => val === lastRules[index]) // raw rule lists aren't equal
	) {
		// Rules need to be parsed again
		window.lastRules = rules;
		pRules = parseRules(rules);
		log(pRules);
		log("New rules parsed");

		// Show errors if any occured
		if(pRules.errors.length > 0) {
			errorEl.innerHTML = "<div>Errors found during parsing rules:</div>" 
				+ pRules.errors.map(a => escapeHTML(a)).join("<br />");
			log("Errors found while parsing rules");
		} else {
			errorEl.innerHTML = "";
		}
	}

	// Apply the rules to the input
	let outputResults = applyRules(pRules, input);
	let outputText;
	if(outputStyle) {
		outputText = outputResults.map((el, idx) => input[idx] + " → " + el).join("\n");
	} else {
		outputText = outputResults.join("\n");
	}
	if(doNormalize) {
		outputText = outputText.normalize();
	}

	outputEl.value = outputText;
	window.lastPRules = pRules;
	let diffTime = new Date() - initTime;
	console.log("Rules applied. Total time: " + diffTime + " ms.");
}

/*
 * Given a set of parsed rules and some input, apply the rules to the input. Loops through each word, then applies
 * each rule to that word.
 */
function applyRules(rules, input) {
	let output = [];
	for(word of input) {
		for(change of rules.changes) {
			let result = "";
			let idx = 0;
			let cursorpos = change.context.indexOf("_");
			let ctx_before = change.context.slice(0,cursorpos).reverse();
			let ctx_after = change.context.slice(cursorpos+1);
			// Keep going until the end of the word is reached
			while(idx < word.length) {
				let match = checkTarget(word, change.find, idx);
				if(match == null) {
					// rule did not match
					result += word[idx];
					idx += 1;
				} else {
					// "find" found, check context
					let startIdx = idx-1;
					let endIdx = match[0];
					if(
						(ctx_before.length == 0 || checkContext(word, startIdx, -1, ctx_before))
						&& (ctx_after.length == 0 || checkContext(word, endIdx, 1, ctx_after))
					){
						// context matches
						result += mkReplacement(change.replace, match[1]);
						idx = endIdx;
					} else {
						// context does not match
						result += word[idx];
						idx += 1;
					}
				}
			}
			if(word != result) {
				logChange(word, result);
				word = result;
			}
		}
		output.push(word);
	}
	return output;
}

/*
 * Check if the target matches the word at the specified index.
 */
function checkTarget(word, find, startIdx) {
	let idx = startIdx;
	let groupHits = {};
	for(segment of find) {
		if(segment.type == "char") {
			if(segment.name == word[idx]) {
				idx += 1;
			} else if(!segment.optional) {
				return null;
			}
		} else if(segment.type == "group") {
			let groupidx = segment.index;
			let options = segment.elements;
			let found = false;
			for(i in options) {
				if(word.slice(idx).startsWith(options[i])) {
					idx += options[i].length;
					groupHits[groupidx] = i;
					found = true;
					break;
				}
			}
			if(!found && !segment.optional) {
				return null;
			}
		} else if(segment.type == "wildcard") {
			idx += 1;
		}
	}
	return [idx, groupHits];
}

/*
 * Create the replacement string, depends on the groups that were matched in the target.
 */
function mkReplacement(replace, groupHits) {
	let res = "";
	for(segment of replace) {
		if(segment.type == "char") {
			res += segment.name;
		} else if(segment.type == "group") {
			let groupidx = segment.index;
			let options = segment.elements;
			if(groupHits[groupidx] < options.length) {
				res += options[groupHits[groupidx]];
			}
		}
	}
	return res;
}

/*
 * Check if one half of the context matches. This can be called twice per target match, once for the context before
 * the _, once for the context after.
 */
function checkContext(word, idx, dir, ctx) {
	for(segment of ctx) {
		if(segment.type == "char") {
			if(segment.name == word[idx]) {
				idx += dir;
			} else if(!segment.optional) {
				return false;
			}
		} else if(segment.type == "group") {
			options = segment.elements;
			let found = false;
			for(i in options) {
				if(dir == 1) {
					if(word.slice(idx).startsWith(options[i])) {
						idx += options[i].length;
						found = true;
						break;
					}
				} else {
					if(word.slice(0,idx+1).endsWith(options[i])) {
						idx -= options[i].length;
						found = true;
						break;
					}
				}
			}
			if(!found && !segment.optional) {
				return false;
			}
		} else if(segment.type == "boundary") {
			if(dir == 1 && idx >= word.length) {
				return true;
			} else if(dir == -1 && idx < 0) {
				return true;
			} else if(!segment.optional) {
				return false;
			}
		} else if(segment.type == "wildcard") {
			if(word[idx] == undefined) {
				return false
			}
			idx += dir;
		}
	}
	return true;
}

// Regexes to detect the next groups
const nextSegment = /[^\/→={}\[\]_#,;?0123456789\(\)](?:[0-9]+)?/;
const nextNonce = /{[^\/→={}\[\]_#;?0123456789\(\)]+}(?:[0-9]+)?/;

/*
 * Parse the list of rules into a JS object.
 */
function parseRules(rules) {
	let res = {
		changes: [],
		errors: []
	};
	let groups = {};
	for(rule of rules) {
		if(rule.startsWith(";")) {
			// comment
			continue;
		} else if(rule.includes("=")) {
			// group creation
			let parts = rule.split("=");
			if(parts.length != 2) {
				res.errors.push("Invalid group declaration: " + rule);
			} else if(parts[0].length != 1) {
				res.errors.push("Invalid group name: " + parts[0]);
			} else {
				groups[parts[0]] = mkGroup(parts[1]);
			}
		} else if(rule.includes("/")) {
			// sound change
			let parts = rule.split("/");
			if(parts.length < 2 || parts.length > 3) {
				// rule must have two or three parts
				res.errors.push("Invalid sound change declaration: " + rule);
			} else {
				if(parts.length == 2) {
					// no context given, rule applies everywhere
					parts[2] = "_";
				}

				let target = mkChangePart(parts[0], groups, false);
				// target must not be empty
				if(target[0].length > 0) {
					let foundRequired = false;
					// target must have at least one required segment
					for(part of target[0]) {
						if(!part.optional) {
							foundRequired = true;
							break;
						}
					}
					if(foundRequired) {
						let replace = mkChangePart(parts[1], groups, false);
						let ctx = mkChangePart(parts[2], groups, true);
						res.errors = res.errors.concat(target[1]).concat(replace[1]).concat(ctx[1]);
						res.changes.push({find: target[0], replace: replace[0], context: ctx[0]});
					} else {
						res.errors.push("Target must have at least one required segment: " + rule);
					}
				} else {
					res.errors.push("Target cannot be left empty: " + rule);
				}
			}
		} else {
			res.errors.push("Invalid rule: " + rule);
		}
	}
	return res;
}

/*
 * Make one part of the sound change, either the target, replacement, or context. 
 * isCtx is only set true for the context.
 */
function mkChangePart(str, groups, isCtx) {
	let remainder = str;
	let nextidx = 0;
	let part = [];
	let errors = [];
	while(remainder.length > 0) {
		// Special elements only in the context
		if(isCtx) {
			if(remainder[0] == "_") {
				part.push("_");
				remainder = remainder.slice(1);
				continue;
			} else if(remainder[0] == "#") {
				part.push({type:"boundary"});
				remainder = remainder.slice(1);
				continue;
			}
		}
		// single-character operators
		if(remainder[0] == "?") {
			// ? operator: mark the last segment as optional
			if(part.length == 0) {
				errors.push("Question mark must follow another segent: " + str);
			} else {
				part[part.length-1].optional = true;
				remainder = remainder.slice(1);
				continue;
			}
		} else if(remainder[0] == "*") {
			// * operator: match any character
			part.push({type: "wildcard"});
			remainder = remainder.slice(1);
			continue;
		} 
		// Try to match either a character or a group
		let segmatch = remainder.match(nextSegment);
		if(segmatch != null && remainder.indexOf(segmatch[0]) == 0) {
			let seg = segmatch[0];
			remainder = remainder.slice(seg.length);
			if(seg.length > 1) {
				// Segment has an index
				if(!isCtx) {
					let idx = seg.slice(1);
					seg = seg[0];
					if(!Object.keys(groups).includes(seg)) {
						errors.push("Index given for character instead of group: " + str);
					} else {
						part.push({type: "group", elements: groups[seg], index: "_"+idx});
					}
				} else {
					errors.push("Indexes cannot be applied in the context: " + str)
				}
			} else {
				// Segment does not have an index
				if(!Object.keys(groups).includes(seg)) {
					part.push({type: "char", name: seg});
				} else {
					if(!isCtx) {
						part.push({type: "group", elements: groups[seg], index: ""+nextidx});
						nextidx += 1;
					} else {
						part.push({type: "group", elements: groups[seg]});
					}
				}
			}
		} else {
			// Try matching a nonce group
			let noncematch = remainder.match(nextNonce);
			if(noncematch != null && remainder.indexOf(noncematch[0]) == 0) {
				let nonce = noncematch[0];
				remainder = remainder.slice(nonce.length);
				nonce = nonce.slice(1);
				let parts = nonce.split("}");
				let group = mkGroup(parts[0]);
				// Allow nesting named groups within nonce groups
				let elements = [];
				for(element of group) {
					if(groups[element]) {
						elements = elements.concat(groups[element]);
					} else {
						elements.push(element);
					}
				}
				if(parts[1].length > 0) {
					// Group has an index
					if(!isCtx) {
						part.push({type: "group", elements: elements, index: "_"+parts[1]});
					} else {
						errors.push("Indexes cannot be applied in the context: " + str)
					}
				} else {
					// Group does not have an index
					if(!isCtx) {
						part.push({type: "group", elements: elements, index: ""+nextidx});
						nextidx += 1;
					} else {
						part.push({type: "group", elements: elements});
					}
				}
			} else {
				errors.push("Invalid rule part: " + str);
				return [part, errors];
			}
		}
	}
	return [part, errors];
}

function mkGroup(str) {
	if(str.includes(",")) {
		return str.split(",").filter(s => s.length > 0);
	} else {
		return str.split("").filter(s => s.length > 0);
	}
}

function escapeHTML(str){
    return new Option(str).innerHTML;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function log(s) {
	if(debug) console.log(s);
}

function logChange(before, after) {
	if(logChanges) console.log(before + " --> " + after);
}
