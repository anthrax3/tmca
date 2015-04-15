/**
Copyright IBM Corp. 2014,2015

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
 *	This module serializes execution of javascript functions.
 *	Pass-in the function to be performed.
 *	This module will perform each function in sequence.
 *
 *	AD 2014-0124-0545
 */

var KitchenSync = function(name) {

	/**
	 * Name of this object.
	 */
	var syncName = name;

	/**
	 * Holds the list of operations to be performed serially.
	 * Contains elements of the form:
	 * 		{ "fn" : function }
	 */
	var queue = [];

	/**
	 * Private utility function executes first element in the queue.
	 * Note: The first element remains in the queue.
	 */
	var launchOperation = function() {
		var m = "kitchensync/" + syncName + "/launchOperation: ";
		console.log(m + "Entry. queue.len=" + queue.length);

		if (0 < queue.length) {
			console.log(m + "A new operation is available on the queue.");

			// Access the first element on the queue.
			var elem = queue[0];

			// Access the function definition from the first element.
			var fn = elem["fn"];

			// Invoke the function.
			console.log(m + "Invoking function.");
			fn();
		}

		console.log(m + "Exit.");
	};

	/**
	 * Enters a synchronized block.
	 *
	 * If no other operations are active, the current operation is executed immediately.
	 * If other operations are active, the current operation is queued for later execution.
	 *
	 * Parms:
	 *		fn - the function to be executed serially.
	 */
	this.enter = function(fn) {
		var m = "kitchensync/" + syncName + "/enter: ";
		console.log(m + "Entry. queue.len=" + queue.length);

		// Add the function and args to end of the queue.
		var elem = { "fn": fn };
		queue.push(elem);
		console.log(m + "Added item to queue. queue.len=" + queue.length);
		
		// Launch the operation iff no other operations are in progress.
		if (1 == queue.length) {
			console.log(m + "Launching new operation because no operations are in progress.");
			launchOperation();
		}
		else {
			console.log(m + "Not launching operation because another operation is already in progress.");
		}
		console.log(m + "Exit. queue.len=" + queue.length);
	}

	/**
	 * Exits a synchronized block.
	 *
	 * Consumers MUST call this function to indicate they are finished.
	 */
	this.exit = function() {
		var m = "kitchensync/" + syncName + "/exit: ";
		console.log(m + "Entry. queue.len=" + queue.length);

		// Remove the current operation from the queue.
		if (0 < queue.length) {
			console.log(m + "Removing current operation from the queue.");
			queue.splice(0,1);
		}
		else {
			console.log(m + "Warning! Corruption! The current/finished operation was not on the queue.");
		}

		// Launch another operation if queued.
		if (0 < queue.length) {
			console.log(m + "Launching the next operation on the queue.");
			launchOperation();
		}
		else {
			console.log(m + "Finished. There are no more operations on the queue.");
		}

		console.log(m + "Exit. queue.len=" + queue.length);
	}

	/**
	 * Gets the name of this sync object.
	 */
	this.getName = function() {
		return syncName;
	}
};


module.exports = KitchenSync;

