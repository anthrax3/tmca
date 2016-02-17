/**
Copyright IBM Corp. 2013,2016

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/
/*

    This module provides a simple and convenient trace logging utility.

*/
var fs = require('fs');
var util = require('util');

/*
    Constructor parameters:
        classname identifies the calling class.
        loglevel controls verbosity for the calling class.  
            5 >= logLevel >= 0
            5=verbose  3=medium  0=errors only
        logfilename optional. may be null.
*/
var Tr = function(classname, logLevel, logfilename) {
    var classname = classname;
    var masterLogLevel = logLevel;
    var logfilename = logfilename;

    // Private helper method returns the two most-significant digits of a positive integer as a string.
    twodigits = function(num) {
        var numString;
        if (num < 10) {
            numString = "0" + num;
        }
        else {
            numString = ("" + num).substring(0,2);
        }
        return numString;
    }    

    // Helper method returns an internationally-understandable timestamp string. 
    this.getLogTimestamp = function() {
        var now = new Date();
		return this.getLogTimestampByDate(now);
	}

    // Helper method returns an internationally-understandable timestamp string for the specified date.
    this.getLogTimestampByDate = function(now) {
        var year = now.getFullYear();
        var month = twodigits(1 + now.getMonth());
        var date = twodigits(now.getDate());
        var hour = twodigits(now.getHours());
        var mins = twodigits(now.getMinutes());
        var secs = twodigits(now.getSeconds());
        var ms = twodigits(now.getMilliseconds());
        return year + "-" + month + date + "-" + hour + mins + "-" + secs + ms;
    }

    // Public method prints a nice human-readable log message, with verbosity control.
	// Specify:  logLevel, methodName, messages...
	// Examples: tr.log(5,m, 'Finished.');
	//           tr.log(5,m, 'Starting.', size);
	//           tr.log(5,m, 'Starting.', size, color);
	//           tr.log(0,m, 'ERROR', err, exception);
    this.log = function() {
		var logLevel = arguments[0];
		var methodName = arguments[1];

        if (logLevel <= masterLogLevel) {
            var msg = "[" + this.getLogTimestamp() + "]" + classname + "/" + methodName + ":";
			for (var i=2; i<arguments.length; i++) {
				msg = msg + ' ' + arguments[i];
			}

            // Print to the console.
            console.log(msg);

            // Print to a log file.
            if (logfilename) {
                fs.appendFileSync(logfilename, msg + "\n", encoding='utf8');
            }
        }
    }

	// Public method prints a javascript object.
	// Inserts timestamp variables to the object for current time.
	// Intended to produce machine-readable output.
	// Intended to append to an ever-growing JSON file.
	//
	// Caveats: This function does not produce perfect-format JSON.
	// - It does not print opening or closing square brackets.
	// - It appends a comma after each entry.
	// - You need to manually append a square brackets after the last entry.
	// I declare these are reasonable tasks, given the rich value provided. 
	this.json = function(jsonObject) {

		// Insert time stamps.
		var date = new Date();
		var now = date.getTime();
		jsonObject["timestamp"] = now;
		jsonObject["timestampString"] = this.getLogTimestampByDate(date);

		// Append to log file.
		if (logfilename) {
			fs.appendFileSync(logfilename, util.inspect(jsonObject) + ",\n", encoding='utf8');
		}
	}
};

module.exports = Tr;
