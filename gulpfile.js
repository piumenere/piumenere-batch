'use strict';

var distDir = 'dist/';
var distCssDir = distDir + 'css';
var thirdPartyLicenseFile = '3rd-party-LICENSE.txt';

var gulp = require('gulp');
var plugins = require('gulp-load-plugins')();
var del = require('del');
var buffer = require('vinyl-buffer');
var source = require('vinyl-source-stream');
var browserify = require('browserify');
var browserSync = require('browser-sync');
var watchify = require('watchify');
var assign = require('lodash.assign');
var preprocessify = require('preprocessify');
var argv = require('yargs').argv;
var runSequence = require('run-sequence');
var config = require('./config.json');

var files = {
    myjs: ['app/**/*.js', '!app/bower_components/**', '!app/**/*test.js', '!app/**/e2e-tests/**'],

    mycss: ['app/app.css'],

    html: ['app/**/*.html', '!app/e2e-tests/**', '!app/bower_components/**'],

    css: [
        'app/bower_components/html5-boilerplate/dist/css/normalize.css',
        'app/bower_components/html5-boilerplate/dist/css/main.css',
        'app/bower_components/bootstrap/dist/css/bootstrap.css',
        'app/bower_components/angular-ui-grid/ui-grid.css',
        'app/bower_components/dangle/css/dangle.css',
        'app/ui-grid-sky-theme.css',
        'app/app.css'
    ],

    img: 'app/img/**',

    uiGridFont: [
        'app/bower_components/angular-ui-grid/ui-grid.eot',
        'app/bower_components/angular-ui-grid/ui-grid.svg',
        'app/bower_components/angular-ui-grid/ui-grid.ttf',
        'app/bower_components/angular-ui-grid/ui-grid.woff'
    ],

    bootstrapFont: ['app/bower_components/bootstrap/dist/fonts/*'],

    dist: ['dist/**/*.html', 'dist/css/**', 'dist/fonts/**', 'dist/img/**', 'dist/*.js'],

    cname: 'app/CNAME',

    license: 'app/LICENSE.txt',

    thirdPartyLicense: 'app/bower_components/**/*LICENSE*'
};

/**
 * JBeret REST API URL is obtained in the following order:
 * 1, from gulp command line args, e.g., gulp --restUrl "http://example.com/myapp/api";
 * 2, from ./config.json restUrl property;
 * 3, from environment variable JBERET_REST_URL;
 * 4, default value '/api'
 */
function getRestUrl() {
    return argv.restUrl || config.restUrl || process.env.JBERET_REST_URL || '/api';
}

/**
 * debug should be false for production build.  Development build may choose to turn it on.
 * When debug is set to true, Angular $log debug is enabled, and javascript and css are not minified.
 * When debug is false, Angular $log is disabled, images are optimized, and javascript and css are uglified and minified.
 *
 * debug can be configured in one of the following ways, in order of precedence:
 * 1, from gulp command line args, e.g., gulp --debug
 * 2, from ./config.json debug property
 * 3, defaults to false.
 */
function isDebug() {
    return argv.debug || config.debug || false;
}

var customOpts = {
    entries: ['app/app.js']
    //debug when creating bundles to have Browserify automatically include Source Maps for easy debugging.
    //debug: true
};
var opts = assign({}, watchify.args, customOpts);


var b = () => {
    return browserify(opts);
};

var w = watchify(b());

var bundle = (tool) => {
    //This will replace /* @echo __REST_URL__ */ with real value
    //and replace __DEBUG__ with real value
    tool.transform(preprocessify, {
        includeExtensions: ['.js'],
        context: {
            '__REST_URL__': getRestUrl(),
            '__DEBUG__': isDebug()
        }
    });

    return tool.bundle()
        .on('error', plugins.util.log.bind(plugins.util, 'Browserify Error'))
        .pipe(source('bundle.js'))

        //minify with source map file
        .pipe(buffer())
        //.pipe(plugins.sourcemaps.init({loadMaps: true}))
        .pipe(plugins.if(!isDebug(), plugins.uglify()))
        // Add transformation tasks to the pipeline here.
        //.pipe(plugins.sourcemaps.write('./'))

        .pipe(gulp.dest(distDir));
};

w.on('update', bundle.bind(null, w));
w.on('log', plugins.util.log);


gulp.task('img', () => gulp.src(files.img)
    .pipe(plugins.if(!isDebug(), plugins.imagemin()))
    .pipe(gulp.dest(distDir + '/img'))
);

gulp.task('jshint', () => gulp.src(files.myjs).pipe(plugins.jshint()));

gulp.task('csslint', () => gulp.src(files.mycss).pipe(plugins.csslint()));

gulp.task('lint', gulp.series('jshint', 'csslint'));

gulp.task('css', () => gulp.src(files.css)
    //.pipe(plugins.sourcemaps.init({loadMaps: true}))
    .pipe(plugins.concat('bundle.css'))
    .pipe(plugins.if(!isDebug(), plugins.minifyCss()))
    //.pipe(plugins.sourcemaps.write('./'))
    .pipe(gulp.dest(distCssDir))
);

gulp.task('html', () => gulp.src(files.html, { base: './app' }).pipe(gulp.dest(distDir)));

gulp.task('bootstrap-font',
    //bootstrap css (bundled in css/bundle.css) references font files in a sibling dir (../fonts)
    () => gulp.src(files.bootstrapFont).pipe(gulp.dest(distDir + 'fonts'))
);

gulp.task('ui-grid-font',
    //angular-ui-grid css references font files in the same directory 
    () => gulp.src(files.uiGridFont).pipe(gulp.dest(distCssDir))
);

gulp.task('font', gulp.series('bootstrap-font', 'ui-grid-font'));

/**
 * Copy project LICENSE.txt and 3rd party license files to dist directory.
 */
gulp.task('license', () => {
    gulp.src(files.thirdPartyLicense)
        .pipe(plugins.concat(thirdPartyLicenseFile))
        .pipe(gulp.dest(distDir));

    return gulp.src(files.license)
        .pipe(gulp.dest(distDir));
});

/**
 * Copy CNAME to dist directory.
 */
gulp.task('cname', () => {
    return gulp.src(files.cname)
        .pipe(gulp.dest(distDir));
});

/**
 * To achieve live update and reload:
 * 1, watchify watches for any js file updates and run browserify when needed;
 * 2, gulp watch task watches for any non-js file updates and run relevant gulp tasks to sync up contents to dist dir;
 * 3, browser-sync watches for any updates in dist dir, and push the new content to browser, including performing
 * css injection.
 */
gulp.task('serve', done => runSequence('watch', 'serve-only', done));

/**
 * Just start browser-sync server, without running the 'build' or 'building' task. 
 * This task is typically used when you know there is no new changes to be built.
 * Any javascript file changes will still be automatically sync'ed to browser,
 * but other files (html, image, css) will not.
 */
gulp.task('serve-only', () => browserSync.init(files.dist, {
    server: {
        baseDir: distDir
    }
}));

/**
 * Build and keep watching for javascript file changes
 */
gulp.task('building', gulp.series('lint', 'img', 'css', 'html', 'font', 'license', done => {
    bundle(w);
    done();
}));

/**
 * Build and keep watching all file changes
 */
gulp.task('watch', gulp.series('building', done => {
    gulp.watch(files.html, gulp.series('html'));
    gulp.watch(files.img, gulp.series('img'));
    gulp.watch(files.mycss, gulp.series('csslint', 'css'));
    gulp.watch(files.bootstrapFont, gulp.series('bootstrap-font'));
    gulp.watch(files.uiGridFont, gulp.series('ui-grid-font'));
    done();
}));

gulp.task('clean', done => {
    del([distDir + '/**']);
    done();
});

/**
 * Build and exit
 */
gulp.task('build', gulp.series('lint', 'img', 'css', 'html', 'font', 'license', 'cname', done => {
    bundle(b());
    done();
}));

gulp.task('default', gulp.series('serve', () => { }));
