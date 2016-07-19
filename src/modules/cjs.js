/*
SystemJS CommonJS Format
*/
// CJS Module Format
// require('...') || exports[''] = ... || exports.asd = ... || module.exports = ...

import {
	__global,
	createEntry,
	exec as __exec,
	isWindows,
} from '../utils';

/* eslint-disable no-param-reassign */

function constructor(next) {
	return function $constructor() {
		next.call(this);

		let windowOrigin;
		if (typeof window !== 'undefined' && typeof document !== 'undefined' && window.location) {
			windowOrigin =
				`${location.protocol}//${location.hostname}${location.port ? `:${location.port}` : ''}`;
		}

		function stripOrigin(path) {
			if (path.substr(0, 8) === 'file:///') return path.substr(7 + !!isWindows);

			if (windowOrigin && path.substr(0, windowOrigin.length) === windowOrigin) {
				return path.substr(windowOrigin.length);
			}

			return path;
		}

		const loader = this;
		this.set('@@cjs-helpers', this.newModule({
			requireResolve(request, parentId) {
				return stripOrigin(loader.normalizeSync(request, parentId));
			},
			getPathVars(moduleId) {
				// remove any plugin syntax
				const pluginIndex = moduleId.lastIndexOf('!');
				let filename;
				if (pluginIndex !== -1) filename = moduleId.substr(0, pluginIndex);
				else filename = moduleId;

				let dirname = filename.split('/');
				dirname.pop();
				dirname = dirname.join('/');

				return {
					filename: stripOrigin(filename),
					dirname: stripOrigin(dirname),
				};
			},
		}));
	};
}

const cjsExportsRegEx = /(?:^\uFEFF?|[^$_a-zA-Z\xA0-\uFFFF.])(exports\s*(\[['"]|\.)|module(\.exports|\['exports'\]|\["exports"\])\s*(\[['"]|[=,\.]))/;
// RegEx adjusted from https://github.com/jbrantly/yabble/blob/master/lib/yabble.js#L339
const cjsRequireRegEx = /(?:^\uFEFF?|[^$_a-zA-Z\xA0-\uFFFF."'])require\s*\(\s*("[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*')\s*\)/g;
const commentRegEx = /(^|[^\\])(\/\*([\s\S]*?)\*\/|([^:]|^)\/\/(.*)$)/mg;

const stringRegEx = /("[^"\\\n\r]*(\\.[^"\\\n\r]*)*"|'[^'\\\n\r]*(\\.[^'\\\n\r]*)*')/g;

// used to support leading #!/usr/bin/env in scripts as supported in Node
const hashBangRegEx = /^\#\!.*/;

const hasOwnProperty = Object.prototype.hasOwnProperty;

function getCJSDeps(source) {
	cjsRequireRegEx.lastIndex = commentRegEx.lastIndex = stringRegEx.lastIndex = 0;

	const deps = [];
	// track string and comment locations for unminified source
	const stringLocations = [];
	const commentLocations = [];

	function inLocation(locations, match) {
		for (let i = 0; i < locations.length; i++) {
			if (locations[i][0] < match.index && locations[i][1] > match.index) return true;
		}
		return false;
	}

	if (source.length / source.split('\n').length < 200) {
		for (;;) {
			const match = stringRegEx.exec(source);
			if (!match) break;
			stringLocations.push([match.index, match.index + match[0].length]);
		}

		// TODO: track template literals here before comments

		for (;;) {
			const match = commentRegEx.exec(source);
			if (!match) break;
			// only track comments not starting in strings
			if (!inLocation(stringLocations, match)) {
				commentLocations.push([match.index + match[1].length, match.index + match[0].length - 1]);
			}
		}
	}

	for (;;) {
		const match = cjsRequireRegEx.exec(source);
		if (!match) break;
		// ensure we're not within a string or comment location
		if (!inLocation(stringLocations, match) && !inLocation(commentLocations, match)) {
			let dep = match[1].substr(1, match[1].length - 2);
			// skip cases like require('" + file + "')
			if (dep.match(/"|'/)) continue;
			// trailing slash requires are removed as they don't map mains in SystemJS
			if (dep[dep.length - 1] === '/') dep = dep.substr(0, dep.length - 1);
			deps.push(dep);
		}
	}

	return deps;
}

function instantiate(next) {
	return function $instantiate(load) {
		if (!load.metadata.format) {
			cjsExportsRegEx.lastIndex = 0;
			cjsRequireRegEx.lastIndex = 0;
			if (cjsRequireRegEx.exec(load.source) || cjsExportsRegEx.exec(load.source)) {
				load.metadata.format = 'cjs';
			}
		}

		if (load.metadata.format === 'cjs') {
			const metaDeps = load.metadata.deps;
			const deps = load.metadata.cjsRequireDetection === false ? [] : getCJSDeps(load.source);

			for (const g in load.metadata.globals) {
				if (load.metadata.globals[g]) deps.push(load.metadata.globals[g]);
			}

			const entry = createEntry();

			load.metadata.entry = entry;

			entry.deps = deps;
			entry.executingRequire = true;
			entry.execute = function $execute(_require, exports, module) {
				function require(name, ...args) {
					if (name[name.length - 1] === '/') name = name.substr(0, name.length - 1);
					return this::_require(name, ...args);
				}
				require.resolve = name => this.get('@@cjs-helpers').requireResolve(name, module.id);
				// support module.paths ish
				module.paths = [];
				module.require = _require;

				// ensure meta deps execute first
				if (!load.metadata.cjsDeferDepsExecute) {
					for (let i = 0; i < metaDeps.length; i++) require(metaDeps[i]);
				}

				const pathVars = this.get('@@cjs-helpers').getPathVars(module.id);
				const __cjsWrapper = {
					exports,
					args: [require, exports, module, pathVars.filename, pathVars.dirname, __global, __global],
				};

				let cjsWrapper =
					'(function(require, exports, module, __filename, __dirname, global, GLOBAL';

				// add metadata.globals to the wrapper arguments
				if (load.metadata.globals) {
					for (const g in load.metadata.globals) {
						if (!load.metadata.globals::hasOwnProperty(g)) continue;
						__cjsWrapper.args.push(require(load.metadata.globals[g]));
						cjsWrapper += `, ${g}`;
					}
				}

				// disable AMD detection
				const define = __global.define;
				__global.define = undefined;
				__global.__cjsWrapper = __cjsWrapper;

				load.source = `${cjsWrapper}") {${load.source.replace(hashBangRegEx, '')}\n}).apply(__cjsWrapper.exports, __cjsWrapper.args);`;

				__exec.call(this, load);

				__global.__cjsWrapper = undefined;
				__global.define = define;
			};
		}

		return next.call(this, load);
	};
}

export default {
	constructor,
	instantiate,
};
