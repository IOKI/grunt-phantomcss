/**
 * grunt-phantomcss
 * https://github.com/chrisgladd/grunt-phantomcss
 *
 * Copyright (c) 2013 Chris Gladd
 * Licensed under the MIT license.
 */
'use strict';

var path = require('path');
var tmp = require('temporary');
var phantomBinaryPath = require('phantomjs').path;
var runnerPath = path.join(__dirname, '..', 'phantomjs', 'runner.js');
var phantomCSSPath = path.join(__dirname, '..', 'bower_components', 'phantomcss');

module.exports = function (grunt) {
    grunt.registerMultiTask('phantomcss', 'CSS Regression Testing', function () {
        var done = this.async();
        var options = this.options({
            screenshots: 'screenshots',
            results: 'results',
            viewportSize: [1280, 800],
            logLevel: 'error'
        });

        // Timeout ID for message checking loop
        var messageCheckTimeout;

        // The number of tempfile lines already read
        var lastLine = 0;

        // The number of failed tests
        var failureCount = 0;

        // This is effectively the project root (location of Gruntfile)
        // This allows relative paths in tests, i.e. casper.start('someLocalFile.html')
        var cwd = process.cwd();

        // Create a temporary file for message passing between the task and PhantomJS
        var tempFile = new tmp.File();

        var deleteDiffScreenshots = function () {
            // Find diff/fail files
            var diffScreenshots = grunt.file.expand([
                path.join(options.screenshots, '*diff.png'),
                path.join(options.screenshots, '*fail.png')
            ]);

            // Delete all of 'em
            diffScreenshots.forEach(function (filepath) {
                grunt.file.delete(filepath);
            });
        };

        var cleanup = function (error) {
            var regex = new RegExp (options.title, 'g');
            // Remove temporary file
            tempFile.unlink();

            // Create the output directory
            grunt.file.mkdir(options.results);

            // Copy fixtures, diffs, and failure images to the results directory
            var allScreenshots = grunt.file.expand(path.join(options.screenshots, '**.png'));

            allScreenshots.forEach(function (filepath) {
                if (regex.test(filepath)){
                    grunt.file.copy(filepath, path.join(options.results, path.basename(filepath)));
                }
            });

            deleteDiffScreenshots();

            done(error || failureCount === 0);
        };

        var checkForMessages = function checkForMessages(stopChecking) {
            // Disable logging temporarily
            grunt.log.muted = true;

            // Read the file, splitting lines on \n, and removing a trailing line
            var lines = grunt.file.read(tempFile.path).split('\n').slice(0, -1);

            // Re-enable logging
            grunt.log.muted = false;

            // Iterate over all lines that haven't already been processed
            lines.slice(lastLine).some(function (line) {
                // Get args and method
                var args = JSON.parse(line);
                var eventName = args[0];

                // Debugging messages
                grunt.log.debug(JSON.stringify(['phantomjs'].concat(args)).magenta);

                // Call handler
                if (messageHandlers[eventName]) {
                    messageHandlers[eventName].apply(null, args.slice(1));
                }
            });

            // Update lastLine so previously processed lines are ignored
            lastLine = lines.length;

            if (stopChecking) {
                clearTimeout(messageCheckTimeout);
            }
            else {
                // Check back in a little bit
                messageCheckTimeout = setTimeout(checkForMessages, 100);
            }
        };

        var messageHandlers = {
            onFail: function (test) {
                grunt.log.writeln('Visual change found for ' + path.basename(test.filename) + ' (' + test.mismatch + '% mismatch)');
            },
            onPass: function (test) {
                grunt.log.writeln('No changes found for ' + path.basename(test.filename));
            },
            onTimeout: function (test) {
                grunt.log.writeln('Timeout while processing ' + path.basename(test.filename));
            },
            onComplete: function (allTests, noOfFails, noOfErrors) {
                if (allTests.length) {
                    var noOfPasses = allTests.length - failureCount;
                    failureCount = noOfFails + noOfErrors;

                    if (failureCount === 0) {
                        grunt.log.ok('All ' + noOfPasses + ' tests passed!');
                    }
                    else {
                        if (noOfErrors === 0) {
                            grunt.log.error(noOfFails + ' tests failed.');
                        }
                        else {
                            grunt.log.error(noOfFails + ' tests failed, ' + noOfErrors + ' had errors.');
                        }
                    }
                }
                else {
                    grunt.log.ok('Baseline screenshots generated in ' + options.screenshots);
                    grunt.log.warn('Check that the generated screenshots are visually correct and delete them if they aren\'t.');
                }
            }
        };

        // Resolve paths for tests
        options.test = [];
        options.beforeEach = [];
        options.testLocation = options.testLocation || '';
        options.update = grunt.option('update');
        options.run = grunt.option('run');


        if (typeof options.rootUrl === 'object') {
            (function () {
                var parameters = grunt.file.read(path.join(__dirname, '..', '..', '..', options.rootUrl.src)).match(options.rootUrl.match),
                    protocol = parameters[1].match('(.*)//(.*)')[1],
                    app = options.rootUrl.app;

                if (protocol.length) {
                    options.rootUrl = parameters[1];
                } else {
                    options.rootUrl = 'https://' + parameters[1].match('.*//(.*)')[1];
                }

                options.rootUrl += app;
            })();
        }

        if (!options.update && !options.run) {
            grunt.fail.fatal('You must run phantomCSS either with --update or --run');
        }

        this.filesSrc.forEach(function (filepath) {
            var files = grunt.file.expand(path.join(__dirname, '..', '..', '..',options.screenshots, '**.png')),
                regex = new RegExp (options.title),
                exists;

            files.forEach(function (file) {
                exists = grunt.file.exists(file);
                if (regex.test(file)){
                    if (options.run) {
                        if (!exists) {
                            grunt.fail.fatal('Reference file for test: ' + options.title + ' doesn\'t exist - run test with --update switch');
                        }
                    } else {
                        if (exists) {
                            grunt.file.delete(file);
                        }
                    }
                }
            });
            options.test.push(path.resolve(filepath));
        });
        if (options.requires && options.requires.length) {
            options.requires.forEach(function (filepath) {
                options.beforeEach.push(path.resolve(options.testLocation + '/' + filepath));
            });
        }

        options.screenshots = path.resolve(options.screenshots);

        // Put failure screenshots in the same place as source screenshots, we'll move/delete them after the test run
        // Note: This duplicate assignment is provided for clarity; PhantomCSS will put failures in the screenshots folder by default
        options.failures = options.screenshots;

        // Pass necessary paths
        options.tempFile = tempFile.path;
        options.phantomCSSPath = phantomCSSPath;

        // Remove old diff screenshots
        deleteDiffScreenshots();

        // Start watching for messages
        checkForMessages();

        grunt.util.spawn({
            cmd: phantomBinaryPath,
            args: [
                runnerPath,
                JSON.stringify(options)
            ],
            opts: {
                cwd: cwd,
                stdio: 'inherit'
            }
        }, function (error, result, code) {
            // When Phantom exits check for remaining messages one last time
            checkForMessages(true);

            cleanup(error);
        });
    });
};
