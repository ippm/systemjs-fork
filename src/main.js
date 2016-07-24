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

Promise.config({
	longStackTraces: true,
});

function noop() {}

export function makeHandlerChain(handlers, lastHandler) {
	let handler = lastHandler || noop;
	for (let i = handlers.length - 1; 0 <= i; i -= 1) {
		handler = handlers[i](handler);
	}
	return handler;
}

export function makeLoaderClass(modules) {
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
		if (constructorChain) this::constructorChain();
	}
	const proto = Object.create(Loader.prototype);
	LoaderClass.prototype = proto;
	proto.constructor = LoaderClass;
	const keys = Object.keys(methodHandlers);
	for (let keyI = 0; keyI < keys.length; keyI += 1) {
		const key = keys[keyI];
		if (key !== 'constructor') {
			proto[key] = makeHandlerChain(
				methodHandlers[key],
				Loader.prototype[key]
			);
		}
	}
	return LoaderClass;
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
