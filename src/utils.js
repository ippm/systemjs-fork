import {coreResolve} from './modules/core';
import URL from './url';
/* eslint-disable no-param-reassign*/

// eslint-disable-next-line no-use-before-define
export const __global = typeof window !== 'undefined' ? window : global;
export const isWorker = typeof window === 'undefined' &&
	typeof self !== 'undefined' &&
	typeof importScripts !== 'undefined';
export const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
export const isWindows =
	typeof process !== 'undefined' &&
	typeof process.platform !== 'undefined' &&
	!!process.platform.match(/^win/);

export function Module() {}
// http://www.ecma-international.org/ecma-262/6.0/#sec-@@tostringtag
Object.defineProperty(Module.prototype, 'toString', {
	value() {
		return 'Module';
	},
});

const hasOwnProperty = Object.prototype.hasOwnProperty;

export function createEntry() {
	return {
		name: null,
		deps: null,
		originalIndices: null,
		declare: null,
		execute: null,
		executingRequire: false,
		declarative: false,
		normalizedDeps: null,
		groupIndex: null,
		evaluated: false,
		module: null,
		esModule: null,
		esmExports: false,
	};
}

export function group(deps) {
	const names = [];
	const indices = [];
	for (let i = 0, l = deps.length; i < l; i++) {
		const index = names.indexOf(deps[i]);
		if (index === -1) {
			names.push(deps[i]);
			indices.push([i]);
		} else indices[index].push(i);
	}
	return {names, indices};
}

// meta first-level extends where:
// array + array appends
// object + object extends
// other properties replace
export function extendMeta(a, b, prepend) {
	for (const p in b) {
		if (!b::hasOwnProperty(p)) continue;
		const val = b[p];
		if (!(p in a)) a[p] = val;
		else if (Array.isArray(val) && Array.isArray(a[p])) {
			a[p] = [].concat(prepend ? val : a[p]).concat(prepend ? a[p] : val);
		} else if (typeof val === 'object' && val !== null && typeof a[p] === 'object') {
			a[p] = Object.assign({}, val, a[p]);
		} else if (!prepend) a[p] = val;
	}
}

export function addToError(err, msg) {
	// parse the stack removing loader code lines for simplification
	let newStack;
	if (!err.originalErr) {
		const stack = (err.stack || err.message || err).toString().split('\n');
		newStack = [];
		for (let i = 0; i < stack.length; i++) {
			if (typeof $__curScript === 'undefined' || stack[i].indexOf($__curScript.src) === -1) {
				newStack.push(stack[i]);
			}
		}
	}

	let newMsg =
		`(SystemJS) ${newStack ? newStack.join('\n\t') : err.message.substr(11)}\n\t${msg}`;

	// Convert file:/// URLs to paths in Node
	if (!isBrowser) newMsg = newMsg.replace(isWindows ? /file:\/\/\//g : /file:\/\//g, '');

	const newErr = new Error(newMsg, err.fileName, err.lineNumber);

	// Node needs stack adjustment for throw to show message
	if (!isBrowser) newErr.stack = newMsg;
	// Clearing the stack stops unnecessary loader lines showing
	else newErr.stack = null;

	// track the original error
	newErr.originalErr = err.originalErr || err;

	return newErr;
}

let curLoad;
let curSystem;
let callCounter = 0;
function preExec(loader, load) {
	curLoad = load;
	if (callCounter++ === 0) curSystem = global.System;
	global.System = global.SystemJS = loader;
}

function postExec() {
	if (--callCounter === 0) global.System = global.SystemJS = curSystem;
	curLoad = undefined;
}

const hasBtoa = typeof btoa !== 'undefined';

function getSource(load, wrap) {
	const lastLineIndex = load.source.lastIndexOf('\n');

	// wrap ES formats with a System closure for System global encapsulation
	if (load.metadata.format === 'global') wrap = false;

	let sourceMap = load.metadata.sourceMap;
	if (sourceMap) {
		if (typeof sourceMap !== 'object') {
			throw new TypeError('load.metadata.sourceMap must be set to an object.');
		}

		sourceMap = JSON.stringify(sourceMap);
	}

	return (wrap ? '(function(System, SystemJS) {' : '') + load.source + (wrap ? '\n})(System, System);' : '')
		// adds the sourceURL comment if not already present
		+ (load.source.substr(lastLineIndex, 15) !== '\n//# sourceURL='
			? '\n//# sourceURL=' + load.address + (sourceMap ? '!transpiled' : '') : '')
		// add sourceMappingURL if load.metadata.sourceMap is set
		+ (sourceMap && hasBtoa && '\n//# ' + 'sourceMappingURL=data:application/json;base64,' + btoa(unescape(encodeURIComponent(sourceMap))) || '');
}

let head;
function scriptExec(load) {
	if (!head) head = document.head || document.body || document.documentElement;

	const script = document.createElement('script');
	script.text = getSource(load, false);
	const onerror = window.onerror;
	let e;
	window.onerror = _e => {
		e = addToError(_e, `Evaluating ${load.address}`);
		if (onerror) onerror.apply(this, arguments);
	};
	preExec(this, load);

	if (load.metadata.integrity) script.setAttribute('integrity', load.metadata.integrity);
	if (load.metadata.nonce) script.setAttribute('nonce', load.metadata.nonce);

	head.appendChild(script);
	head.removeChild(script);
	postExec();
	window.onerror = onerror;
	if (e) throw e;
}

let supportsScriptExec = false;
if (isBrowser && typeof document !== 'undefined' && document.getElementsByTagName) {
	const scripts = document.getElementsByTagName('script');
	$__curScript = scripts[scripts.length - 1];

	if (!(window.chrome && window.chrome.extension || navigator.userAgent.match(/^Node\.js/))) {
		supportsScriptExec = true;
	}
}

const nwjs = typeof process !== 'undefined' && process.versions && process.versions['node-webkit'];
let vm;
export function exec(load) {
	if (!load.source) return undefined;
	if ((load.metadata.integrity || load.metadata.nonce) && supportsScriptExec) {
		return scriptExec.call(this, load);
	}
	try {
		preExec(this, load);
		// global scoped eval for node (avoids require scope leak)
		if (this._nodeRequire && !nwjs) {
			vm = vm || this._nodeRequire('vm');
			vm.runInThisContext(getSource(load, true), {
				filename: `${load.address}${load.metadata.sourceMap ? '!transpiled' : ''}`,
			});
		} else (0, eval)(getSource(load, true));
		postExec();
	} catch (e) {
		postExec();
		throw addToError(e, `Evaluating ${load.address}`);
	}
	return undefined;
}

const absURLRegEx = /^[^\/]+:\/\//;
export function isAbsolute(name) {
	return name.match(absURLRegEx);
}
export function isRel(name) {
	return (name[0] === '.' && (!name[1] || name[1] === '/' || name[1] === '.')) || name[0] === '/';
}
export function isPlain(name) {
	return !isRel(name) && !isAbsolute(name);
}

export let baseURI;
// environent baseURI detection
if (typeof document !== 'undefined' && document.getElementsByTagName) {
	baseURI = document.baseURI;

	if (!baseURI) {
		const bases = document.getElementsByTagName('base');
		baseURI = bases[0] && bases[0].href || window.location.href;
	}
} else if (typeof location !== 'undefined') baseURI = global.location.href;

// sanitize out the hash and querystring
if (baseURI) {
	baseURI = baseURI.split('#')[0].split('?')[0];
	baseURI = baseURI.substr(0, baseURI.lastIndexOf('/') + 1);
} else if (typeof process !== 'undefined' && process.cwd) {
	baseURI = `file://${isWindows ? '/' : ''}${process.cwd()}/`;
	if (isWindows) baseURI = baseURI.replace(/\\/g, '/');
} else throw new TypeError('No environment baseURI');

export const baseURIObj = new URL(baseURI);

export function urlResolve(name, parent) {
	// url resolution shortpaths
	if (name[0] === '.') {
		// dot-relative url normalization
		if (name[1] === '/' && name[2] !== '.') {
			return (parent && parent.substr(0, parent.lastIndexOf('/') + 1) || baseURI) + name.substr(2);
		}
	} else if (name[0] !== '/' && name.indexOf(':') === -1) {
		// plain parent normalization
		return (parent && parent.substr(0, parent.lastIndexOf('/') + 1) || baseURI) + name;
	}

	return new URL(
		name,
		parent && parent.replace(/#/g, '%05') || baseURIObj
	).href.replace(/%05/g, '#');
}

function defineOrCopyProperty(targetObj, sourceObj, propName) {
	const d = Object.getOwnPropertyDescriptor(sourceObj, propName);
	if (d) Object.defineProperty(targetObj, propName, d);
}

// converts any module.exports object into an object ready for SystemJS.newModule
export function getESModule(exports) {
	const esModule = {};
	// don't trigger getters/setters in environments that support them
	if ((typeof exports === 'object' || typeof exports === 'function') && exports !== global) {
		for (const p in exports) {
			// The default property is copied to esModule later on
			if (p === 'default') continue;
			defineOrCopyProperty(esModule, exports, p);
		}
	}
	esModule.default = exports;
	Object.defineProperty(esModule, '__useDefault', {
		value: true,
	});
	return esModule;
}

export function warn(msg) {
	if (this.warnings && typeof console !== 'undefined' && console.warn) console.warn(msg);
}

export function extendPkgConfig(pkgCfgA, pkgCfgB, pkgName, loader, warnInvalidProperties) {
	for (const prop in pkgCfgB) {
		if (['main', 'format', 'defaultExtension', 'basePath'].indexOf(prop) !== -1) {
			pkgCfgA[prop] = pkgCfgB[prop];
		} else if (prop === 'map') {
			pkgCfgA.map = pkgCfgA.map || {};
			Object.assign(pkgCfgA.map, pkgCfgB.map);
		} else if (prop === 'meta') {
			pkgCfgA.meta = pkgCfgA.meta || {};
			Object.assign(pkgCfgA.meta, pkgCfgB.meta);
		} else if (prop === 'depCache') {
			for (const d in pkgCfgB.depCache) {
				let dNormalized;
				if (d.substr(0, 2) === './') dNormalized = `${pkgName}/${d.substr(2)}`;
				else dNormalized = coreResolve.call(loader, d);
				loader.depCache[dNormalized] =
					(loader.depCache[dNormalized] || []).concat(pkgCfgB.depCache[d]);
			}
		} else if (
			warnInvalidProperties &&
			['browserConfig', 'nodeConfig', 'devConfig', 'productionConfig'].indexOf(prop) === -1 &&
			(!pkgCfgB.hasOwnProperty || pkgCfgB.hasOwnProperty(prop))
		) {
			warn.call(
				loader,
				`"${prop}" is not a valid package configuration option in package ${pkgName}`
			);
		}
	}
}

// deeply-merge (to first level) config with any existing package config
export function setPkgConfig(loader, pkgName, cfg, prependConfig) {
	let pkg;

	// first package is config by reference for fast path, cloned after that
	if (!loader.packages[pkgName]) pkg = loader.packages[pkgName] = cfg;
	else {
		const basePkg = loader.packages[pkgName];
		pkg = loader.packages[pkgName] = {};

		extendPkgConfig(pkg, prependConfig ? cfg : basePkg, pkgName, loader, prependConfig);
		extendPkgConfig(pkg, prependConfig ? basePkg : cfg, pkgName, loader, !prependConfig);
	}

	// main object becomes main map
	if (typeof pkg.main === 'object') {
		pkg.map = pkg.map || {};
		pkg.map['./@main'] = pkg.main;
		pkg.main.default = pkg.main.default || './';
		pkg.main = '@main';
	}

	return pkg;
}

// NB no specification provided for System.paths, used ideas discussed in
// https://github.com/jorendorff/js-loaders/issues/25
export function applyPaths(loader, name) {
	// most specific (most number of slashes in path) match wins
	let pathMatch = '';
	let wildcard;
	let maxWildcardPrefixLen = 0;

	const paths = loader.paths;
	const pathsCache = loader._loader.paths;

	// check to see if we have a paths entry
	for (const p in paths) {
		if (!paths::hasOwnProperty(p)) continue;

		// paths sanitization
		let path = paths[p];
		if (path !== pathsCache[p]) {
			path = paths[p] = pathsCache[p] = urlResolve(
				paths[p],
				isRel(paths[p]) ? baseURI : loader.baseURL
			);
		}

		// exact path match
		if (p.indexOf('*') === -1) {
			if (name === p) return paths[p];
			else if (
				// support trailing / in paths rules
				name.substr(0, p.length - 1) === p.substr(0, p.length - 1) &&
				(name.length < p.length || name[p.length - 1] === p[p.length - 1]) &&
				(paths[p][paths[p].length - 1] === '/' || paths[p] === '')
			) {
				return paths[p].substr(0, paths[p].length - 1) +
					(name.length > p.length ? (paths[p] && '/' || '') + name.substr(p.length) : '');
			}
		} else {
			// wildcard path match
			const pathParts = p.split('*');
			if (pathParts.length > 2) throw new TypeError('Only one wildcard in a path is permitted');

			const wildcardPrefixLen = pathParts[0].length;
			if (
				wildcardPrefixLen >= maxWildcardPrefixLen &&
				name.substr(0, pathParts[0].length) === pathParts[0] &&
				name.substr(name.length - pathParts[1].length) === pathParts[1]
			) {
				maxWildcardPrefixLen = wildcardPrefixLen;
				pathMatch = p;
				wildcard = name.substr(
					pathParts[0].length,
					name.length - pathParts[1].length - pathParts[0].length
				);
			}
		}
	}

	let outPath = paths[pathMatch];
	if (typeof wildcard === 'string') outPath = outPath.replace('*', wildcard);
	return outPath;
}

export function getMapMatch(map, name) {
	let bestMatch;
	let bestMatchLength = 0;

	for (const p in map) {
		if (
			name.substr(0, p.length) === p &&
			(name.length === p.length || name[p.length] === '/')
		) {
			const curMatchLength = p.split('/').length;
			if (curMatchLength <= bestMatchLength) continue;
			bestMatch = p;
			bestMatchLength = curMatchLength;
		}
	}

	return bestMatch;
}

export function readMemberExpression(p, value) {
	const pParts = p.split('.');
	while (pParts.length) value = value[pParts.shift()];
	return value;
}

const sysConditions = ['browser', 'node', 'dev', 'build', 'production', 'default'];
export function parseCondition(condition) {
	let conditionExport;
	let conditionModule;
	let negation = condition[0] === '~';
	const conditionExportIndex = condition.lastIndexOf('|');
	if (conditionExportIndex !== -1) {
		conditionExport = condition.substr(conditionExportIndex + 1);
		conditionModule = condition.substr(negation, conditionExportIndex - negation);

		if (negation) {
			warn.call(
				this,
				`Condition negation form "${condition}" is deprecated for "${conditionModule}|~${conditionExport}"`
			);
		}

		if (conditionExport[0] === '~') {
			negation = true;
			conditionExport = conditionExport.substr(1);
		}
	} else {
		conditionExport = 'default';
		conditionModule = condition.substr(negation);
		if (sysConditions.indexOf(conditionModule) !== -1) {
			conditionExport = conditionModule;
			conditionModule = null;
		}
	}

	return {
		module: conditionModule || '@system-env',
		prop: conditionExport,
		negate: negation,
	};
}

export function serializeCondition(conditionObj) {
	return `${conditionObj.module}|${conditionObj.negate ? '~' : ''}${conditionObj.prop}`;
}

export function resolveCondition(conditionObj, parentName, bool) {
	return this.normalize(conditionObj.module, parentName).then(normalizedCondition =>
		this.load(normalizedCondition).then(() => {
			const m = readMemberExpression(conditionObj.prop, this.get(normalizedCondition));

			if (bool && typeof m !== 'boolean') {
				throw new TypeError(`Condition ${serializeCondition(conditionObj)} did not resolve to a boolean.`);
			}

			return conditionObj.negate ? !m : m;
		})
	);
}

const interpolationRegEx = /#\{[^\}]+\}/;
export function interpolateConditional(name, parentName) {
	// first we normalize the conditional
	const conditionalMatch = name.match(interpolationRegEx);

	if (!conditionalMatch) return Promise.resolve(name);

	const conditionObj = parseCondition.call(
		this,
		conditionalMatch[0].substr(2, conditionalMatch[0].length - 3)
	);

	// in builds, return normalized conditional
	if (this.builder) {
		return this.normalize(conditionObj.module, parentName).then(conditionModule => {
			conditionObj.module = conditionModule;
			return name.replace(interpolationRegEx, `#{${serializeCondition(conditionObj)}}`);
		});
	}

	return resolveCondition.call(this, conditionObj, parentName, false)
		.then(conditionValue => {
			if (typeof conditionValue !== 'string') {
				throw new TypeError(`The condition value for ${name} doesn't resolve to a string.`);
			}

			if (conditionValue.indexOf('/') !== -1) {
				throw new TypeError(`Unabled to interpolate conditional ${name}${parentName ? ` in ' + ${parentName}` : ''}\n\tThe condition value ${conditionValue} cannot contain a "/" separator.`);
			}

			return name.replace(interpolationRegEx, conditionValue);
		});
}
