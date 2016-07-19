/*
 * Meta Extension
 *
 * Sets default metadata on a load record (load.metadata) from
 * loader.metadata via SystemJS.meta function.
 *
 *
 * Also provides an inline meta syntax for module meta in source.
 *
 * Eg:
 *
 * loader.meta({
 *	 'my/module': { deps: ['jquery'] }
 *	 'my/*': { format: 'amd' }
 * });
 *
 * Which in turn populates loader.metadata.
 *
 * load.metadata.deps and load.metadata.format will then be set
 * for 'my/module'
 *
 * The same meta could be set with a my/module.js file containing:
 *
 * my/module.js
 *	 "format amd";
 *	 "deps[] jquery";
 *	 "globals.some value"
 *	 console.log('this is my/module');
 *
 * Configuration meta always takes preference to inline meta.
 *
 * Multiple matches in wildcards are supported and ammend the meta.
 *
 *
 * The benefits of the function form is that paths are URL-normalized
 * supporting say
 *
 * loader.meta({ './app': { format: 'cjs' } });
 *
 * Instead of needing to set against the absolute URL (https://site.com/app.js)
 *
 */

import {extendMeta, warn} from '../utils';

/* eslint-disable no-param-reassign */

function constructor(next) {
	return function $constructor() {
		this.meta = {};
		next.call(this);
	};
}

function locate(next) {
	return function $locate(load) {
		const meta = this.meta;
		const name = load.name;

		// NB for perf, maybe introduce a fast-path wildcard lookup cache here
		// which is checked first

		// apply wildcard metas
		let bestDepth = 0;
		let wildcardIndex;
		for (const module in meta) {
			wildcardIndex = module.indexOf('*');
			if (wildcardIndex === -1) continue;
			if (
				module.substr(0, wildcardIndex) === name.substr(0, wildcardIndex) &&
				module.substr(wildcardIndex + 1) ===
					name.substr(name.length - module.length + wildcardIndex + 1)
			) {
				const depth = module.split('/').length;
				if (depth > bestDepth) bestDepth = depth;
				extendMeta(load.metadata, meta[module], bestDepth !== depth);
			}
		}

		// apply exact meta
		if (meta[name]) extendMeta(load.metadata, meta[name]);

		return next.call(this, load);
	};
}

// detect any meta header syntax
// only set if not already set
const metaRegEx = /^(\s*\/\*[^\*]*(\*(?!\/)[^\*]*)*\*\/|\s*\/\/[^\n]*|\s*"[^"]+"\s*;?|\s*'[^']+'\s*;?)+/;
const metaPartRegEx = /\/\*[^\*]*(\*(?!\/)[^\*]*)*\*\/|\/\/[^\n]*|"[^"]+"\s*;?|'[^']+'\s*;?/g;

function setMetaProperty(target, p, value) {
	const pParts = p.split('.');
	let curPart;
	while (pParts.length > 1) {
		curPart = pParts.shift();
		target = target[curPart] = target[curPart] || {};
	}
	curPart = pParts.shift();
	if (!(curPart in target)) target[curPart] = value;
}

function translate(next) {
	return function $translate(load) {
		// shortpath for bundled
		if (load.metadata.format === 'defined') {
			load.metadata.deps = load.metadata.deps || [];
			return Promise.resolve(load.source);
		}

		// NB meta will be post-translate pending transpiler conversion to plugins
		const meta = load.source.match(metaRegEx);
		if (meta) {
			const metaParts = meta[0].match(metaPartRegEx);

			for (let i = 0; i < metaParts.length; i++) {
				const curPart = metaParts[i];
				let len = curPart.length;

				const firstChar = curPart.substr(0, 1);
				if (curPart.substr(len - 1, 1) === ';') len--;

				if (firstChar !== '"' && firstChar !== "'") continue;

				const metaString = curPart.substr(1, curPart.length - 3);
				let metaName = metaString.substr(0, metaString.indexOf(' '));

				if (metaName) {
					const metaValue = metaString.substr(
						metaName.length + 1,
						metaString.length - metaName.length - 1
					);

					if (metaName.substr(metaName.length - 2, 2) === '[]') {
						metaName = metaName.substr(0, metaName.length - 2);
						load.metadata[metaName] = load.metadata[metaName] || [];
						load.metadata[metaName].push(metaValue);
					} else if (Array.isArray(load.metadata[metaName])) {
						// temporary backwards compat for previous "deps" syntax
						warn.call(
							this,
							`Module ${load.name} contains deprecated "deps ${metaValue}" meta syntax.\nThis should be updated to "deps[] ${metaValue}" for pushing to array meta.`
						);
						load.metadata[metaName].push(metaValue);
					} else setMetaProperty(load.metadata, metaName, metaValue);
				} else load.metadata[metaString] = true;
			}
		}

		return next.apply(this, arguments);
	};
}

export default {
	constructor,
	locate,
	translate,
};
