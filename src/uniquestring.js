/**
Copyright IBM Corp. 2014

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


/**
 *	This module generates and returns a unique string on each call.
 *  Useful for tmp file names.
 *
 *	AD 2014-0126-1603
 */
var Tr = require('./tr.js');

var UniqueString = function() {

    var name = "uniquestring.js";
	var tr = new Tr(name, 5, "log.txt");

	var lastReturnedTimestamp = 0;  // usually of the form '2014-0126-1603-2345'
	var lastReturnedSuffix = 0;     // increments from 0, 1, 2, etc

	/**
	 * Returns a unique string on every call.
	 */
	this.getUniqueString = function() {
		var m = "getUniqueString";

		// Get current timestamp in form YYYY-MMDD-HHMM-SSMM.
		var currentTimestamp = tr.getLogTimestamp();
		//tr.log(5,m,"Entry. currentTimestamp=" + currentTimestamp);

		if (currentTimestamp == lastReturnedTimestamp) {
			lastReturnedSuffix += 1;
			//tr.log(5,m,"Same timestamp. Incremented suffix.");
		}
		else {
			lastReturnedTimestamp = currentTimestamp;
			lastReturnedSuffix = 0;
			tr.log(5,m,"Updated timestamp. Reset suffix.");
		}

		// Concatenate the timestamp plus suffix.
		var filename = currentTimestamp + "-" + lastReturnedSuffix;

		//tr.log(5,m,"Exit. Returning " + filename);
		return filename;
	}
};


module.exports = UniqueString;

