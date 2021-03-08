document.getElementById("apply").addEventListener("click", applySoundChanges);

let debug = false;

function applySoundChanges(event) {
	let rules = document.getElementById("rules").value.split("\n").map(a => a.replace(/\s/g,"")).filter(a => a.length > 0);
	let input = document.getElementById("input").value.split(/\s/g).filter(a => a.length > 0);
	let outputEl = document.getElementById("output");
	let errorEl = document.getElementById("errors");
	log(rules);
	log(input);

	let parsedrules = parseRules(rules);
	log(parsedrules);

	if(parsedrules.errors.length > 0) {
		errorEl.innerHTML = "<div>Errors found during parsing rules:</div>" + parsedrules.errors.map(a => escapeHTML(a)).join("<br />");
	} else {
		errorEl.innerHTML = "";
	}

	outputEl.value = applyRules(parsedrules, input).join("\n");
}

function applyRules(rules, input) {
	let output = [];
	for(word of input) {
		for(change of rules.changes) {
			let result = "";
			let idx = 0;
			let cursorpos = change.context.indexOf("_");
			let ctx_before = change.context.slice(0,cursorpos).reverse();
			let ctx_after = change.context.slice(cursorpos+1);
			while(idx < word.length) {
				let match = getFindMatch(word, change.find, idx);
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
				log(word + " --> " + result);
				word = result;
			}
		}
		output.push(word);
	}
	return output;
}

function getFindMatch(word, find, startIdx) {
	let idx = startIdx;
	let groupHits = {};
	for(segment of find) {
		if(segment.type == "char") {
			if(segment.name == word[idx]) {
				idx += 1;
			} else {
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
			if(!found) {
				return null;
			}
		}
	}
	return [idx, groupHits];
}

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

function checkContext(word, idx, dir, ctx) {
	for(segment of ctx) {
		if(segment.type == "char") {
			if(segment.name == word[idx]) {
				idx += dir;
			} else {
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
			if(!found) {
				return false;
			}
		} else if(segment.type == "boundary") {
			if(dir == 1 && idx >= word.length) {
				return true;
			} else if(dir == -1 && idx < 0) {
				return true;
			} else {
				return false;
			}
		}
	}
	return true;
}

const nextSegment = /[^\/→={}\[\]_#,;0123456789\(\)](?:[0-9]+)?/;
const nextNonce = /{[^\/→={}\[\]_#;0123456789\(\)]+}(?:[0-9]+)?/;

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
			let parts = rule.split("/");
			if(parts.length < 2 || parts.length > 3) {
				res.errors.push("Invalid sound change declaration: " + rule);
			} else {
				if(parts.length == 2) {
					parts[2] = "_";
				}
				let target = mkSCPart(parts[0], groups, true);
				if(target[0].length > 0) {
					let replace = mkSCPart(parts[1], groups, true);
					let ctx = mkSCPart(parts[2], groups, false);
					res.errors = res.errors.concat(target[1]).concat(replace[1]).concat(ctx[1]);
					res.changes.push({find: target[0], replace: replace[0], context: ctx[0]});
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

function mkSCPart(str, groups, isNotCtx) {
	let remainder = str;
	let nextidx = 0;
	let part = [];
	let errors = [];
	while(remainder.length > 0) {
		if(!isNotCtx) {
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
		let segmatch = remainder.match(nextSegment);
		if(segmatch != null && remainder.indexOf(segmatch[0]) == 0) {
			let seg = segmatch[0];
			remainder = remainder.slice(seg.length);
			if(seg.length > 1) {
				if(isNotCtx) {
					let idx = seg.slice(1);
					seg = seg[0];
					if(!Object.keys(groups).includes(seg)) {
						errors.push("Index given for segment instead of group: " + str);
					} else {
						part.push({type: "group", elements: groups[seg], index: "_"+idx});
					}
				} else {
					errors.push("Indexes cannot be applied in the context: " + str)
				}
			} else {
				if(!Object.keys(groups).includes(seg)) {
					part.push({type: "char", name: seg});
				} else {
					if(isNotCtx) {
						part.push({type: "group", elements: groups[seg], index: ""+nextidx});
						nextidx += 1;
					} else {
						part.push({type: "group", elements: groups[seg]});
					}
				}
			}
		} else {
			let noncematch = remainder.match(nextNonce);
			if(noncematch != null && remainder.indexOf(noncematch[0]) == 0) {
				let nonce = noncematch[0];
				remainder = remainder.slice(nonce.length);
				nonce = nonce.slice(1);
				let parts = nonce.split("}");
				let group = mkGroup(parts[0]);
				let elements = [];
				for(element of group) {
					if(groups[element]) {
						elements = elements.concat(groups[element]);
					} else {
						elements.push(element);
					}
				}
				if(parts[1].length == 0) {
					if(isNotCtx) {
						part.push({type: "group", elements: elements, index: ""+nextidx});
						nextidx += 1;
					} else {
						part.push({type: "group", elements: elements});
					}
				} else {
					if(isNotCtx) {
						part.push({type: "group", elements: elements, index: "_"+parts[1]});
					} else {
						errors.push("Indexes cannot be applied in the context: " + str)
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
		return str.split(",");
	} else {
		return str.split("");
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
