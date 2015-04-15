/**
Copyright IBM Corp. 2013,2014

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
 * This class is a faux interface for hypervisor classes in TMCA.
 * 
 * It represents the actions which can be performed on a hypervisor
 * 
 * All callbacks returns (err, responseObject) 
 *    where responseObject contains int rc, boolean running, and string msg.  
 * Example:
 *    return callback(null,{"rc": 0, "msg": "Started VM successfully." });
 *
 * Constructor parameter 'blob' includes hypervisor object.
 * Example:
 *    var blob = { "hypervisor": { "name": "fred", "domain": "wilma.example.com" }};
 *
 * AD 2013-1019-1255
 */
var IHypervisor = function(blob) {

	var name = blob.name;
	var domain = blob.domain;

	/**
	 * API: Returns name of this class. Useful for setup and debug.
	 */
    this.getName = function() {
		return this.name;
    };

	/**
	 * API: Lease.  Performs any required initialization.
	 */
	this.leaseVM = function(vmname, snapshotname, blob, callback) {
		return callback(null,{"rc": 0, "msg": "Ok." });
	};

	/**
	 * API: Unlease.  Performs any required cleanup.
	 */
	this.unleaseVM = function(vmname, blob, callback) {
		return callback(null,{"rc": 0, "msg": "Ok." });
	};

	/**
	 * API: Indicates whether the VM is running.
	 *
	 * Callback returns (err, responseObject) 
	 *    where responseObject contains int rc, boolean running, and string msg.  
	 */
	this.isRunning = function(vmname, blob, callback) {
		return callback(null,{"rc": 0, "running": true, "msg": "VM is running." });
	};

	/**
	 * API: Restores snapshot.
	 */
	this.restoreVM = function(vmname, snapshotname, blob, callback) {
		return callback(null,{"rc": 0, "msg": "Ok." });
	};

	/**
	 * API: Starts the specified VM.
	 */
	this.startVM = function(vmname, snapshotname, blob, callback) {
		return callback(null,{"rc": 0, "msg": "Ok." });
	};

	/**
	 * API: Stops the specified VM.
	 */
	this.stopVM = function(vmname, blob, callback) {
		return callback(null,{"rc": 0, "msg": "Ok." });
	};

	/**
	 * API: Gets the IP address of the specified VM.
	 */
	this.getIP = function(vmname, blob, callback) {
		return callback(null,{"rc": 0, "ip": "9.42.121.126", "msg": "Ok." });
	};

	/**
	 * API: Takes snapshot.
	 */
	this.takeSnapshot = function(vmname, snapshotname, blob, callback) {
		return callback(null,{"rc": 0, "msg": "Ok." });
	};

	/**
	 * API: Renames snapshot.
	 */
	this.renameSnapshot = function(vmname, srcsnapshotname, dstsnapshotname, blob, callback) {
		return callback(null,{"rc": 0, "msg": "Ok." });
	};
};

module.exports = IHypervisor;

