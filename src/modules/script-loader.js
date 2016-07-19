/*
 * Script tag fetch
 *
 * When load.metadata.scriptLoad is true, we load via script tag injection.
 */

import {
	isBrowser,
	isWorker,
	__global,
} from '../utils';

let head;
if (typeof document !== 'undefined') {
	head = document.getElementsByTagName('head')[0];
}

let curSystem;
let curRequire;

// if doing worker executing, this is set to the load record being executed
let workerLoad = null;

// interactive mode handling method courtesy RequireJS
const ieEvents = head && (() => {
	const s = document.createElement('script');
	const isOpera = typeof opera !== 'undefined' && opera.toString() === '[object Opera]';
	return s.attachEvent &&
		!(s.attachEvent.toString && s.attachEvent.toString().indexOf('[native code') < 0) &&
		!isOpera;
})();

// IE interactive-only part
// we store loading scripts array as { script: <script>, load: {...} }
const interactiveLoadingScripts = [];
let interactiveScript;
function getInteractiveScriptLoad() {
	if (interactiveScript && interactiveScript.script.readyState === 'interactive') {
		return interactiveScript.load;
	}

	for (let i = 0; i < interactiveLoadingScripts.length; i++) {
		if (interactiveLoadingScripts[i].script.readyState === 'interactive') {
			interactiveScript = interactiveLoadingScripts[i];
			return interactiveScript.load;
		}
	}
	return undefined;
}

// System.register, System.registerDynamic, AMD define pipeline
// this is called by the above methods when they execute
// we then run the reduceRegister_ collection function either immediately
// if we are in IE and know the currently executing script (interactive)
// or later if we need to wait for the synchronous load callback to know the script
let loadingCnt = 0;
let registerQueue = [];
function pushRegister_(next) {
	return function $pushRegister_(register) {
		// if using eval-execution then skip
		if (next.call(this, register)) return false;

		// if using worker execution, then we're done
		if (workerLoad) this.reduceRegister_(workerLoad, register);
		else if (ieEvents) {
			// detect if we know the currently executing load (IE)
			// if so, immediately call reduceRegister
			this.reduceRegister_(getInteractiveScriptLoad(), register);
		} else if (loadingCnt) {
			// otherwise, add to our execution queue
			// to call reduceRegister on sync script load event
			registerQueue.push(register);
		} else {
			// if we're not currently loading anything though
			// then do the reduction against a null load
			// (out of band named define or named register)
			// note even in non-script environments, this catch is used
			this.reduceRegister_(null, register);
		}

		return true;
	};
}

function webWorkerImport(loader, load) {
	return new Promise((resolve, reject) => {
		if (load.metadata.integrity) {
			reject(new Error('Subresource integrity checking is not supported in web workers.'));
			return;
		}

		workerLoad = load;
		try {
			// eslint-disable-next-line no-undef
			importScripts(load.address); // TODO: WTF?! importScripts is undefined
		} catch (e) {
			workerLoad = null;
			reject(e);
			return;
		}
		workerLoad = null;

		// if nothing registered, then something went wrong
		if (!load.metadata.entry) {
			reject(new Error(`${load.address} did not call System.register or AMD define`));
			return;
		}

		resolve('');
	});
}

// override fetch to use script injection
function fetch(next) {
	return function $fetch(load) {
		const loader = this;

		if (
			load.metadata.format === 'json' ||
			!load.metadata.scriptLoad ||
			(!isBrowser && !isWorker)
		) {
			return next.call(this, load);
		}

		if (isWorker) return webWorkerImport(loader, load);

		return new Promise((resolve, reject) => {
			const s = document.createElement('script');
			s.async = true;

			function cleanup() {
				__global.System = curSystem;
				__global.require = curRequire;

				if (s.detachEvent) {
					// eslint-disable-next-line no-use-before-define
					s.detachEvent('onreadystatechange', complete);
					for (let i = 0; i < interactiveLoadingScripts.length; i++) {
						if (interactiveLoadingScripts[i].script === s) {
							if (interactiveScript && interactiveScript.script === s) interactiveScript = null;
							interactiveLoadingScripts.splice(i, 1);
						}
					}
				} else {
					/* eslint-disable no-use-before-define */
					s.removeEventListener('load', complete, false);
					s.removeEventListener('error', error, false);
					/* eslint-enable no-use-before-define */
				}

				head.removeChild(s);
			}

			function complete() {
				if (s.readyState && s.readyState !== 'loaded' && s.readyState !== 'complete') return;

				loadingCnt--;

				// complete call is sync on execution finish
				// (in ie already done reductions)
				if (!load.metadata.entry && !registerQueue.length) {
					loader.reduceRegister_(load);
				} else if (!ieEvents) {
					for (let i = 0; i < registerQueue.length; i++) {
						loader.reduceRegister_(load, registerQueue[i]);
					}
					registerQueue = [];
				}

				cleanup();

				// if nothing registered, then something went wrong
				if (!load.metadata.entry && !load.metadata.bundle) {
					reject(new Error(`${load.name} did not call System.register or AMD define. If loading a global module configure the global name via the meta exports property for script injection support.`));
				}

				resolve('');
			}

			function error() {
				cleanup();
				reject(new Error(`Unable to load script ${load.address}`));
			}

			if (load.metadata.crossOrigin) s.crossOrigin = load.metadata.crossOrigin;

			if (load.metadata.integrity) s.setAttribute('integrity', load.metadata.integrity);

			if (ieEvents) {
				s.attachEvent('onreadystatechange', complete);
				interactiveLoadingScripts.push({
					script: s,
					load,
				});
			} else {
				s.addEventListener('load', complete, false);
				s.addEventListener('error', error, false);
			}

			loadingCnt++;

			curSystem = __global.System;
			curRequire = __global.require;

			s.src = load.address;
			head.appendChild(s);
		});
	};
}

export default {
	pushRegister_,
	fetch,
};
