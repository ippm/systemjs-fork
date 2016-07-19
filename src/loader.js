import {
	__global,
	addToError,
} from './utils';
/* eslint-disable no-use-before-define, no-param-reassign, no-shadow */

const defineProperty = Object.defineProperty;
const hasOwnProperty = Object.prototype.hasOwnProperty;

/*
*********************************************************************************************

	Dynamic Module Loader Polyfill

		- Implemented exactly to the former 2014-08-24 ES6 Specification Draft Rev 27, Section 15
		http://wiki.ecmascript.org/doku.php?id=harmony:specification_drafts#august_24_2014_draft_rev_27

		- Functions are commented with their spec numbers, with spec differences commented.

		- Spec bugs are commented in this code with links.

		- Abstract functions have been combined where possible, and their associated functions
			commented.

		- Realm implementation is entirely omitted.

*********************************************************************************************
*/

function Module() {}
// http://www.ecma-international.org/ecma-262/6.0/#sec-@@tostringtag
defineProperty(Module.prototype, 'toString', {
	value() {
		return 'Module';
	},
});
export default function Loader() {
	this._loader = {
		loaderObj: this,
		loads: [],
		modules: {},
		importPromises: {},
		moduleRecords: {},
	};

	// 26.3.3.6
	defineProperty(this, 'global', {
		get() {
			return __global;
		},
	});

	// 26.3.3.13 realm not implemented
}
// 15.2.3 - Runtime Semantics: Loader State

// 15.2.3.11
export function createLoaderLoad(object) {
	return {
		// modules is an object for ES5 implementation
		modules: {},
		loads: [],
		loaderObj: object,
	};
}

// 15.2.3.2 Load Records and LoadRequest Objects

let anonCnt = 0;

// 15.2.3.2.1
function createLoad(name) {
	return {
		status: 'loading',
		name: name || `<Anonymous${++anonCnt}>`,
		linkSets: [],
		dependencies: [],
		metadata: {},
	};
}

// 15.2.3.2.2 createLoadRequestObject, absorbed into calling functions

// 15.2.4

// 15.2.4.1
function loadModule(loader, name, options) {
	return new Promise(asyncStartLoadPartwayThrough({
		step: options.address ? 'fetch' : 'locate',
		loader,
		moduleName: name,
		// allow metadata for import https://bugs.ecmascript.org/show_bug.cgi?id=3091
		moduleMetadata: options && options.metadata || {},
		moduleSource: options.source,
		moduleAddress: options.address,
	}));
}

// 15.2.4.2
function requestLoad(loader, request, refererName, refererAddress) {
	// 15.2.4.2.1 CallNormalize
	return new Promise(resolve => {
		resolve(loader.loaderObj.normalize(request, refererName, refererAddress));
	})
	// 15.2.4.2.2 GetOrCreateLoad
	.then(name => {
		let load;
		if (loader.modules[name]) {
			load = createLoad(name);
			load.status = 'linked';
			// https://bugs.ecmascript.org/show_bug.cgi?id=2795
			load.module = loader.modules[name];
			return load;
		}

		for (let i = 0, l = loader.loads.length; i < l; i++) {
			load = loader.loads[i];
			if (load.name !== name) continue;
			return load;
		}

		load = createLoad(name);
		loader.loads.push(load);

		proceedToLocate(loader, load);

		return load;
	});
}

// 15.2.4.3
function proceedToLocate(loader, load) {
	proceedToFetch(loader, load,
		Promise.resolve()
		// 15.2.4.3.1 CallLocate
		.then(() =>
			loader.loaderObj.locate({
				name: load.name,
				metadata: load.metadata,
			})
		)
	);
}

// 15.2.4.4
function proceedToFetch(loader, load, p) {
	proceedToTranslate(loader, load,
		p
		// 15.2.4.4.1 CallFetch
		.then(address => {
			// adjusted, see https://bugs.ecmascript.org/show_bug.cgi?id=2602
			if (load.status !== 'loading') return undefined;
			load.address = address;

			return loader.loaderObj.fetch({
				name: load.name,
				metadata: load.metadata,
				address,
			});
		})
	);
}

// 15.2.4.5
function proceedToTranslate(loader, load, p) {
	p
	// 15.2.4.5.1 CallTranslate
	.then(source => {
		if (load.status !== 'loading') return undefined;

		load.address = load.address || load.name;

		return Promise.resolve(loader.loaderObj.translate({
			name: load.name,
			metadata: load.metadata,
			address: load.address,
			source,
		}))

		// 15.2.4.5.2 CallInstantiate
		.then(source => {
			load.source = source;
			return loader.loaderObj.instantiate({
				name: load.name,
				metadata: load.metadata,
				address: load.address,
				source,
			});
		})

		// 15.2.4.5.3 InstantiateSucceeded
		.then(instantiateResult => {
			if (instantiateResult === undefined) {
				throw new TypeError('Declarative modules unsupported in the polyfill.');
			}
			if (typeof instantiateResult !== 'object') {
				throw new TypeError('Invalid instantiate return value');
			}
			load.depsList = instantiateResult.deps || [];
			load.execute = instantiateResult.execute;
		})
		// 15.2.4.6 ProcessLoadDependencies
		.then(() => {
			load.dependencies = [];
			const depsList = load.depsList;

			const loadPromises = [];
			for (let i = 0, l = depsList.length; i < l; i++) {
				((request, index) => {
					loadPromises.push(
						requestLoad(loader, request, load.name, load.address)

						// 15.2.4.6.1 AddDependencyLoad (load is parentLoad)
						.then(depLoad => {
							// adjusted from spec to maintain dependency order
							// this is due to the System.register internal implementation needs
							load.dependencies[index] = {
								key: request,
								value: depLoad.name,
							};

							if (depLoad.status !== 'linked') {
								const linkSets = load.linkSets.concat([]);
								for (let i = 0, l = linkSets.length; i < l; i++) {
									addLoadToLinkSet(linkSets[i], depLoad);
								}
							}

							// console.log('AddDependencyLoad ' + depLoad.name + ' for ' + load.name);
							// snapshot(loader);
						})
					);
				})(depsList[i], i);
			}

			return Promise.all(loadPromises);
		})

		// 15.2.4.6.2 LoadSucceeded
		.then(() => {
			// console.log('LoadSucceeded ' + load.name);
			// snapshot(loader);

			console.assert(load.status === 'loading', 'is loading');

			load.status = 'loaded';

			const linkSets = load.linkSets.concat([]);
			for (let i = 0, l = linkSets.length; i < l; i++) {
				updateLinkSetOnLoad(linkSets[i], load);
			}
		});
	})
	// 15.2.4.5.4 LoadFailed
	.catch(exc => {
		load.status = 'failed';
		load.exception = exc;

		const linkSets = load.linkSets.concat([]);
		for (let i = 0, l = linkSets.length; i < l; i++) {
			linkSetFailed(linkSets[i], load, exc);
		}

		console.assert(load.linkSets.length === 0, 'linkSets not removed');
	});
}

// 15.2.4.7 PromiseOfStartLoadPartwayThrough absorbed into calling functions

// 15.2.4.7.1
function asyncStartLoadPartwayThrough(stepState) {
	return resolve => {
		const {loader, step, moduleName: name} = stepState;

		if (loader.modules[name]) {
			throw new TypeError(`"${name}" already exists in the module table`);
		}

		// adjusted to pick up existing loads
		let existingLoad;
		for (let i = 0, l = loader.loads.length; i < l; i++) {
			if (loader.loads[i].name === name) {
				existingLoad = loader.loads[i];

				if (step === 'translate' && !existingLoad.source) {
					existingLoad.address = stepState.moduleAddress;
					proceedToTranslate(loader, existingLoad, Promise.resolve(stepState.moduleSource));
				}

				// a primary load -> use that existing linkset if it is for the direct load here
				// otherwise create a new linkset unit
				if (existingLoad.linkSets.length &&
						existingLoad.linkSets[0].loads[0].name === existingLoad.name) {
					// eslint-disable-next-line no-loop-func
					existingLoad.linkSets[0].done.then(() => resolve(existingLoad));
					return;
				}
			}
		}

		const load = existingLoad || createLoad(name);

		load.metadata = stepState.moduleMetadata;

		const linkSet = createLinkSet(loader, load);

		loader.loads.push(load);

		resolve(linkSet.done);

		if (step === 'locate') proceedToLocate(loader, load);
		else if (step === 'fetch') {
			proceedToFetch(loader, load, Promise.resolve(stepState.moduleAddress));
		} else {
			console.assert(step === 'translate', 'translate step');
			load.address = stepState.moduleAddress;
			proceedToTranslate(loader, load, Promise.resolve(stepState.moduleSource));
		}
	};
}

// Declarative linking functions run through alternative implementation:
// 15.2.5.1.1 CreateModuleLinkageRecord not implemented
// 15.2.5.1.2 LookupExport not implemented
// 15.2.5.1.3 LookupModuleDependency not implemented

// 15.2.5.2.1
function createLinkSet(loader, startingLoad) {
	const linkSet = {
		loader,
		loads: [],
		startingLoad, // added see spec bug https://bugs.ecmascript.org/show_bug.cgi?id=2995
		loadingCount: 0,
	};
	linkSet.done = new Promise((resolve, reject) => {
		linkSet.resolve = resolve;
		linkSet.reject = reject;
	});
	addLoadToLinkSet(linkSet, startingLoad);
	return linkSet;
}
// 15.2.5.2.2
function addLoadToLinkSet(linkSet, load) {
	if (load.status === 'failed') return;

	for (let i = 0, l = linkSet.loads.length; i < l; i++) {
		if (linkSet.loads[i] === load) return;
	}

	linkSet.loads.push(load);
	load.linkSets.push(linkSet);

	// adjustment, see https://bugs.ecmascript.org/show_bug.cgi?id=2603
	if (load.status !== 'loaded') linkSet.loadingCount++;

	const loader = linkSet.loader;

	for (let i = 0, l = load.dependencies.length; i < l; i++) {
		if (!load.dependencies[i]) continue;

		const name = load.dependencies[i].value;

		if (loader.modules[name]) continue;

		for (let j = 0, d = loader.loads.length; j < d; j++) {
			if (loader.loads[j].name !== name) continue;

			addLoadToLinkSet(linkSet, loader.loads[j]);
			break;
		}
	}
	// console.log('add to linkset ' + load.name);
	// snapshot(linkSet.loader);
}

// linking errors can be generic or load-specific
// this is necessary for debugging info
function doLink(linkSet) {
	let error = false;
	try {
		link(linkSet, (load, exc) => {
			linkSetFailed(linkSet, load, exc);
			error = true;
		});
	} catch (e) {
		linkSetFailed(linkSet, null, e);
		error = true;
	}
	return error;
}

// 15.2.5.2.3
function updateLinkSetOnLoad(linkSet, load) {
	// console.log('update linkset on load ' + load.name);
	// snapshot(linkSet.loader);

	console.assert(load.status === 'loaded' || load.status === 'linked', 'loaded or linked');

	linkSet.loadingCount--;

	if (linkSet.loadingCount > 0) return undefined;

	// adjusted for spec bug https://bugs.ecmascript.org/show_bug.cgi?id=2995
	const startingLoad = linkSet.startingLoad;

	// non-executing link variation for loader tracing
	// on the server. Not in spec.
	/** */
	if (linkSet.loader.loaderObj.execute === false) {
		const loads = [].concat(linkSet.loads);
		for (let i = 0, l = loads.length; i < l; i++) {
			const load = loads[i];
			load.module = {
				name: load.name,
				module: _newModule({}),
				evaluated: true,
			};
			load.status = 'linked';
			finishLoad(linkSet.loader, load);
		}
		return linkSet.resolve(startingLoad);
	}
	/** */

	const abrupt = doLink(linkSet);

	if (abrupt) return undefined;

	console.assert(linkSet.loads.length === 0, 'loads cleared');

	return linkSet.resolve(startingLoad);
}

// 15.2.5.2.4
function linkSetFailed(linkSet, load, exc) {
	const loader = linkSet.loader;

	/* eslint-disable no-labels */
	checkError:
	if (load) {
		if (linkSet.loads[0].name === load.name) {
			exc = addToError(exc, `Error loading ${load.name}`);
		} else {
			for (let i = 0; i < linkSet.loads.length; i++) {
				const pLoad = linkSet.loads[i];
				for (let j = 0; j < pLoad.dependencies.length; j++) {
					const dep = pLoad.dependencies[j];
					if (dep.value === load.name) {
						exc = addToError(exc, `Error loading ${load.name} as "${dep.key}" from ${pLoad.name}`);
						break checkError;
					}
				}
			}
			exc = addToError(exc, `Error loading ${load.name} from ${linkSet.loads[0].name}`);
		}
	} else {
		exc = addToError(exc, `Error linking ${linkSet.loads[0].name}`);
	}
	/* eslint-enable no-labels */

	const loads = linkSet.loads.concat([]);
	for (let i = 0, l = loads.length; i < l; i++) {
		const load = loads[i];

		// store all failed load records
		loader.loaderObj.failed = loader.loaderObj.failed || [];
		if (loader.loaderObj.failed.indexOf(load) === -1) {
			loader.loaderObj.failed.push(load);
		}

		const linkIndex = load.linkSets.indexOf(linkSet);
		console.assert(linkIndex !== -1, 'link not present');
		load.linkSets.splice(linkIndex, 1);
		if (load.linkSets.length === 0) {
			const globalLoadsIndex = linkSet.loader.loads.indexOf(load);
			if (globalLoadsIndex !== -1) linkSet.loader.loads.splice(globalLoadsIndex, 1);
		}
	}
	linkSet.reject(exc);
}

// 15.2.5.2.5
function finishLoad(loader, load) {
	// add to global trace if tracing
	if (loader.loaderObj.trace) {
		if (!loader.loaderObj.loads) loader.loaderObj.loads = {};
		const depMap = {};
		load.dependencies.forEach(dep => {
			depMap[dep.key] = dep.value;
		});
		loader.loaderObj.loads[load.name] = {
			name: load.name,
			deps: load.dependencies.map(dep => dep.key),
			depMap,
			address: load.address,
			metadata: load.metadata,
			source: load.source,
		};
	}
	// if not anonymous, add to the module table
	if (load.name) {
		console.assert(
			!loader.modules[load.name] || loader.modules[load.name].module === load.module.module,
			'load not in module table'
		);
		loader.modules[load.name] = load.module;
	}
	let loadIndex = loader.loads.indexOf(load);
	if (loadIndex !== -1) loader.loads.splice(loadIndex, 1);
	for (let i = 0, l = load.linkSets.length; i < l; i++) {
		loadIndex = load.linkSets[i].loads.indexOf(load);
		if (loadIndex !== -1) load.linkSets[i].loads.splice(loadIndex, 1);
	}
	load.linkSets.splice(0, load.linkSets.length);
}

function doDynamicExecute(linkSet, load, linkError) {
	let module;
	try {
		module = load.execute();
	} catch (e) {
		linkError(load, e);
		return undefined;
	}
	if (!module || !(module instanceof Module)) {
		linkError(load, new TypeError('Execution must define a Module instance'));
		return undefined;
	}
	return module;
}

// 26.3 Loader

// 26.3.1.1
// defined at top

// importPromises adds ability to import a module twice without error -
// https://bugs.ecmascript.org/show_bug.cgi?id=2601
function createImportPromise(loader, name, promise) {
	const importPromises = loader._loader.importPromises;
	importPromises[name] = promise.then(
		m => {
			importPromises[name] = undefined;
			return m;
		},
		e => {
			importPromises[name] = undefined;
			throw e;
		}
	);
	return importPromises[name];
}

Loader.prototype = {
	// 26.3.3.1
	constructor: Loader,
	// 26.3.3.2
	define(name, source, options) {
		// check if already defined
		if (this._loader.importPromises[name]) throw new TypeError('Module is already loading.');
		return createImportPromise(this, name, new Promise(asyncStartLoadPartwayThrough({
			step: 'translate',
			loader: this._loader,
			moduleName: name,
			moduleMetadata: options && options.metadata || {},
			moduleSource: source,
			moduleAddress: options && options.address,
		})));
	},
	// 26.3.3.3
	delete(name) {
		const loader = this._loader;
		delete loader.importPromises[name];
		delete loader.moduleRecords[name];
		return loader.modules[name] ? delete loader.modules[name] : false;
	},
	// 26.3.3.4 entries not implemented
	// 26.3.3.5
	get(key) {
		if (!this._loader.modules[key]) return undefined;
		return this._loader.modules[key].module;
	},
	// 26.3.3.7
	has(name) {
		return !!this._loader.modules[name];
	},
	// 26.3.3.8
	import(name, parentName) {
		if (typeof parentName === 'object') parentName = parentName.name;
		// added, see https://bugs.ecmascript.org/show_bug.cgi?id=2659
		return Promise.resolve(this.normalize(name, parentName)).then(name => {
			const loader = this._loader;

			if (loader.modules[name]) return loader.modules[name].module;

			return (loader.importPromises[name] ||
					createImportPromise(this, name, loadModule(loader, name, {}))
				.then(load => {
					delete loader.importPromises[name];
					return load.module.module;
				}));
		});
	},
	// 26.3.3.9 keys not implemented
	// 26.3.3.10
	load(name) {
		const loader = this._loader;
		if (loader.modules[name]) return Promise.resolve();
		return (loader.importPromises[name] ||
			createImportPromise(this, name, new Promise(asyncStartLoadPartwayThrough({
				step: 'locate',
				loader,
				moduleName: name,
				moduleMetadata: {},
				moduleSource: undefined,
				moduleAddress: undefined,
			})))
		.then(() => {
			delete loader.importPromises[name];
		}));
	},
	// 26.3.3.11
	module(source, options) {
		const load = createLoad();
		load.address = options && options.address;
		const linkSet = createLinkSet(this._loader, load);
		const sourcePromise = Promise.resolve(source);
		const loader = this._loader;
		const p = linkSet.done.then(() => load.module.module);
		proceedToTranslate(loader, load, sourcePromise);
		return p;
	},
	// 26.3.3.12
	newModule(obj) {
		if (typeof obj !== 'object') throw new TypeError('Expected object');

		const m = new Module();

		let pNames = [];
		if (Object.getOwnPropertyNames && obj !== null) pNames = Object.getOwnPropertyNames(obj);
		else {
			for (const key in obj) {
				if (hasOwnProperty.call(obj, key)) pNames.push(key);
			}
		}

		for (let i = 0; i < pNames.length; i++) {
			(key => {
				defineProperty(m, key, {
					configurable: false,
					enumerable: true,
					get() {
						return obj[key];
					},
					set() {
						throw new Error('Module exports cannot be changed externally.');
					},
				});
			})(pNames[i]);
		}

		return Object.freeze(m);
	},
	// 26.3.3.14
	set(name, module) {
		if (!(module instanceof Module)) {
			throw new TypeError(`Loader.set(${name}, module) must be a module`);
		}
		this._loader.modules[name] = {module};
	},
	// 26.3.3.15 values not implemented
	// 26.3.3.16 @@iterator not implemented
	// 26.3.3.17 @@toStringTag not implemented

	// 26.3.3.18.1
	normalize() {},
	// 26.3.3.18.2
	locate(load) {
		return load.name;
	},
	// 26.3.3.18.3
	fetch() {
	},
	// 26.3.3.18.4
	translate(load) {
		return load.source;
	},
	// 26.3.3.18.5
	instantiate() {
	},
};

const _newModule = Loader.prototype.newModule;

/*
* ES6 Module Declarative Linking Code
*/
function link(linkSet, linkError) {
	const loader = linkSet.loader;

	if (!linkSet.loads.length) return;

	const loads = linkSet.loads.concat([]);

	for (let i = 0; i < loads.length; i++) {
		const load = loads[i];

		const module = doDynamicExecute(linkSet, load, linkError);
		if (!module) return;
		load.module = {
			name: load.name,
			module,
		};
		load.status = 'linked';

		finishLoad(loader, load);
	}
}
