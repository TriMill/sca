document.getElementById("apply").addEventListener("click", applySoundChanges);

let debug = false;

/*
 * V=aiuə
 * K=kgŋ
 * K/Kʷ/_u
 * {td}/{θð}/V_V
 */
rules = {
	groups: {
		"V": ["a", "i", "u", "ə"],
		"K": ["k", "g", "ŋ"],
	},
	changes: [
		{
			find: [
				{type: "group", name: "K", index: "0"}
			],
			replace: [
				{type: "group", name: "K", index: "0"},
				{type: "char", name: "ʷ"}
			],
			context: [
				"_",
				{type: "char", name: "u"}
			]
		},
		{
			find: [
				{type: "nonce", elements: ["t", "d"], index: "0"}
			],
			replace: [
				{type: "nonce", elements: ["θ", "ð"], index: "0"}
			],
			context: [
				{type: "group", name: "V"},
				"_",
				{type: "group", name: "V"}
			]
		}
	]
};

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

// function checkContext(word, idx, dir, ctx, groups)

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
				let match = getFindMatch(word, change.find, idx, rules.groups);
				if(match == null) {
					// rule did not match
					result += word[idx];
					idx += 1;
				} else {
					// "find" found, check context
					let startIdx = idx-1;
					let endIdx = match[0];
					if(
						(ctx_before.length == 0 || checkContext(word, startIdx, -1, ctx_before, rules.groups))
						&& (ctx_after.length == 0 || checkContext(word, endIdx, 1, ctx_after, rules.groups))
					){
						// context matches
							result += mkReplacement(change.replace, rules.groups, match[1]);
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

function getFindMatch(word, find, startIdx, groups) {
	let idx = startIdx;
	let groupHits = {};
	for(segment of find) {
		if(segment.type == "char") {
			if(segment.name == word[idx]) {
				idx += 1;
			} else {
				return null;
			}
		} else if(segment.type == "nonce" || segment.type == "group") {
			let options = [];
			let groupidx = segment.index;
			if(segment.type == "nonce") {
				options = segment.elements;
			} else {
				options = groups[segment.name];
			}
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

function mkReplacement(replace, groups, groupHits) {
	let res = "";
	for(segment of replace) {
		if(segment.type == "char") {
			res += segment.name;
		} else if(segment.type == "nonce" || segment.type == "group") {
			let options = [];
			let groupidx = segment.index;
			if(segment.type == "nonce") {
				options = segment.elements;
			} else {
				options = groups[segment.name];
			}
			if(groupHits[groupidx] < options.length) {
				res += options[groupHits[groupidx]];
			}
		}
	}
	return res;
}

function checkContext(word, idx, dir, ctx, groups) {
	for(segment of ctx) {
		if(segment.type == "char") {
			if(segment.name == word[idx]) {
				idx += dir;
			} else {
				return false;
			}
		} else if(segment.type == "nonce" || segment.type == "group") {
			let options = [];
			if(segment.type == "nonce") {
				options = segment.elements;
			} else {
				options = groups[segment.name];
			}
			let found = false;
			for(i in options) {
				if(dir == 1) {
					if(word.slice(idx).startsWith(options[i])) {
						idx += options[i].length;
						found = true;
						break;
					}
				} else {
					if(word.slice(0,idx).endsWith(options[i])) {
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
		groups: {},
		changes: [],
		errors: []
	};
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
				res.groups[parts[0]] = mkGroup(parts[1]);
			}
		} else if(rule.includes("/")) {
			let parts = rule.split("/");
			if(parts.length < 2 || parts.length > 3) {
				res.errors.push("Invalid sound change declaration: " + rule);
			} else {
				if(parts.length == 2) {
					parts[2] = "_";
				}
				let keys = Object.keys(res.groups);
				let find = mkSCPart(parts[0], keys, true);
				let replace = mkSCPart(parts[1], keys, true);
				let ctx = mkSCPart(parts[2], keys, false);
				res.errors = res.errors.concat(find[1]).concat(replace[1]).concat(ctx[1]);
				res.changes.push({find: find[0], replace: replace[0], context: ctx[0]});
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
					if(!groups.includes(seg)) {
						errors.push("Index given for segment instead of group: " + str);
					} else {
						part.push({type: "group", name: seg, index: "_"+idx});
					}
				} else {
					errors.push("Indexes cannot be applied in the context: " + str)
				}
			} else {
				if(!groups.includes(seg)) {
					part.push({type: "char", name: seg});
				} else {
					if(isNotCtx) {
						part.push({type: "group", name: seg, index: ""+nextidx});
						nextidx += 1;
					} else {
						part.push({type: "group", name: seg});
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
				if(parts[1].length == 0) {
					if(isNotCtx) {
						part.push({type: "nonce", elements: group, index: ""+nextidx});
						nextidx += 1;
					} else {
						part.push({type: "nonce", elements: group});
					}
				} else {
					if(isNotCtx) {
						part.push({type: "nonce", elements: group, index: "_"+parts[1]});
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
