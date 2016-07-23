import Loader from './loader';
import {
	core,
	meta,
	alias,
	amd,
	bundles,
	cjs,
	plugins,
	register,
	package as _package,
	scriptLoader,
} from './modules';

function noop() {}

export function makeHandlerChain(handlers, lastHandler) {
	let handler = lastHandler || noop;
	for (let i = handlers.length - 1; 0 <= i; i -= 1) {
		handler = handlers[i](handler);
	}
	return handler;
}

export function makeLoaderClassWoWrapping(modules) {
	const methodHandlers = Object.create(null);
	for (let moduleI = 0; moduleI < modules.length; moduleI += 1) {
		const module = modules[moduleI];
		const keys = Object.keys(module);
		for (let keyI = 0; keyI < keys.length; keyI += 1) {
			const key = keys[keyI];
			if (!(key in methodHandlers)) methodHandlers[key] = [];
			methodHandlers[key].push(module[key]);
		}
	}
	const constructorChain = do {
		if ('constructor' in methodHandlers) makeHandlerChain(methodHandlers.constructor);
	};
	function LoaderClass() {
		Loader.call(this);
		this.paths = {};
		this._loader.paths = {};
		if (constructorChain) constructorChain.call(this);
	}
	const proto = Object.create(Loader.prototype);
	LoaderClass.prototype = proto;
	proto.constructor = LoaderClass;
	const keys = Object.keys(methodHandlers);
	for (let keyI = 0; keyI < keys.length; keyI += 1) {
		const key = keys[keyI];
		if (key !== 'constructor') proto[key] = makeHandlerChain(methodHandlers[key], proto[key]);
	}
	return LoaderClass;
}

const SYNC_METHODS = ['config', 'register', 'registerDynamic'];

function wrapMethod(key) {
	const isSync = SYNC_METHODS.indexOf(key) !== -1;
	if (isSync) {
		return function $syncWrapper(...args) {
			this._syncMethodPromise = this._syncMethodPromise.then(() => this._loader[key](...args));
		};
	}
	return function $asyncWrapper(...args) {
		return this._syncMethodPromise.then(() => this._loader[key](...args));
	};
}

export function makeLoaderClass(modules) {
	const LoaderClass = makeLoaderClassWoWrapping(modules);
	function WrapperClass() {
		this._loader = new LoaderClass();
		this._syncMethodPromise = Promise.resolve();
	}
	const lProto = LoaderClass.prototype;
	const wProto = WrapperClass.prototype;
	// eslint-disable-next-line guard-for-in
	for (const key in lProto) wProto[key] = wrapMethod(key);
	return WrapperClass;
}

export const constructor = makeLoaderClass([
	meta,
	bundles,
	plugins,
	amd,
	cjs,
	alias,
	register,
	scriptLoader,
	_package,
	core,
]);
