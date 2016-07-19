/*
 * Traceur, Babel and TypeScript transpile hook for Loader
 */
import Loader from './loader';
import {__global} from './utils';

/* eslint-disable no-param-reassign */

// use Traceur by default
Loader.prototype.transpiler = 'traceur';

function doTraceurCompile(source, compiler, filename) {
	try {
		return compiler.compile(source, filename);
	} catch (e) {
		// on older versions of traceur (<0.9.3), an array of errors is thrown
		// rather than a single error.
		if (e.length) throw e[0];
		throw e;
	}
}

function traceurTranspile(load, traceur) {
	const options = this.traceurOptions || {};
	options.modules = 'instantiate';
	options.script = false;
	if (options.sourceMaps === undefined) options.sourceMaps = 'inline';
	options.filename = load.address;
	options.inputSourceMap = load.metadata.sourceMap;
	options.moduleName = false;
	const compiler = new traceur.Compiler(options);
	return doTraceurCompile(load.source, compiler, options.filename);
}


function babelTranspile(load, babel) {
	const options = this.babelOptions || {};
	options.modules = 'system';
	if (options.sourceMap === undefined) options.sourceMap = 'inline';
	options.inputSourceMap = load.metadata.sourceMap;
	options.filename = load.address;
	options.code = true;
	options.ast = false;
	return babel.transform(load.source, options).code;
}

function typescriptTranspile(load, ts) {
	const options = this.typescriptOptions || {};
	options.target = options.target || ts.ScriptTarget.ES5;
	if (options.sourceMap === undefined) options.sourceMap = true;
	if (options.sourceMap && options.inlineSourceMap !== false) {
		options.inlineSourceMap = true;
	}
	options.module = ts.ModuleKind.System;
	return ts.transpile(load.source, options, load.address);
}

export default function transpile(load) {
	return Promise.resolve(
		__global[this.transpiler === 'typescript' ? 'ts' : this.transpiler] ||
		(this.pluginLoader || this).import(this.transpiler)
	)
		.then(transpiler => {
			if (transpiler.__useDefault) transpiler = transpiler.default;

			let transpileFunction;
			if (transpiler.Compiler) transpileFunction = traceurTranspile;
			else if (transpiler.createLanguageService) transpileFunction = typescriptTranspile;
			else transpileFunction = babelTranspile;

			// note __moduleName will be part of the transformer meta in
			// future when we have the spec for this
			const transpiled =
				'(function(__moduleName){' +
				`${transpileFunction.call(this, load, transpiler)}\n` +
				`})("${load.name}");\n` +
				`//# sourceURL=${load.address}!transpiled`;
			return transpiled;
		});
}
