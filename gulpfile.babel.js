import gulp from 'gulp';
import lazyReq from 'lazyreq';

global.Promise = Promise;

const $ = lazyReq(require, {
	cached: 'gulp-cached',
	env: 'gulp-env',
	sourcemaps: 'gulp-sourcemaps',
	runSequence: ['run-sequence', rs => rs.use(gulp)],
	eslint: 'gulp-eslint',
	rollupStream: 'rollup-stream',
	rollupBabel: 'rollup-plugin-babel',
	vinylSourceBuffer: 'vinyl-source-buffer',
	exec: ['child_process', 'exec', Promise.promisify],
});

gulp.task('build', () =>
	$.rollupStream({
		entry: './src/main.js',
		format: 'cjs',
		sourceMap: true,
		exports: 'named',
		plugins: [
			$.rollupBabel({
				babelrc: false,
				presets: ['es2015-rollup'],
				plugins: [
					'transform-promise-to-bluebird',
					'transform-async-to-bluebird',
					'transform-function-bind',
					'transform-runtime',
				],
				runtimeHelpers: true,
			}),
		],
	})
		.pipe($.vinylSourceBuffer('systemjs.js'))
		.pipe($.sourcemaps.init({loadMaps: true}))
		.pipe($.sourcemaps.write('./'))
		.pipe(gulp.dest('./build'))
);

gulp.task('lint', () =>
	gulp.src(['./src/**/*.js', './gulpfile.babel.js', './test/**/*.js'])
		.pipe($.cached('lint'))
		.pipe($.eslint())
		.pipe($.eslint.format())
		.pipe($.eslint.failOnError())
);

gulp.task('clean', () => $.exec('git clean -xf'));

gulp.task('watch', ['build', 'lint'], () => {
	gulp.watch('./src/**/*.js', ['build', 'lint']);
});

gulp.task('default', (cb) => {
	$.runSequence(
		'clean',
		['build', 'lint', 'test'],
		cb
	);
});
