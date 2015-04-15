/**
Copyright IBM Corp. 2013,2015

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
 * This class provides the connection to an OpenStack hypervisor.
 *
 * This class implements the faux interface for hypervisor classes, ihypervisor.js
 * 
 * AD 2013-1108-0930
 */
var Tr = require('./../tr.js');
var Opstx = require('./opstx.js');
var UniqueString = require('./../uniquestring.js');
var	proc = require('child_process');
var fs = require('fs');
var util = require('util');
var KitchenSync = require('./../kitchensync.js');

var floatSync = new KitchenSync("floatSync");

var OpenStackHypervisor = function(blob) {

	var hypervisor = blob.hypervisor;
    var name = hypervisor.name;
	var domain = hypervisor.domain;
	var tr = new Tr(name, 5, "log.txt");
	var opstx = new Opstx();

	/**
	 * Init: Instantiate an object to return unique strings, used for tmp file names.
	 */
	var uniqueString = new UniqueString();

	/**
	 * Constants
	 */
	var OPSTX_PYTHON_FILENAME = "hypervisors/opstx.py";
	var OS_FLAVOR_DEFAULT = "m1.medium";
	var OS_KEY_NAME = "";   // AD 2014-0130 Not used. No need to push SSH credentials into the VMs.


	/**
	 * API: Returns name of this class. Useful for setup and debug.
	 */
    this.getName = function() {
		var m = "getName";
		tr.log(5,m,"Entry. Returning name=" + name);
		return name;
    };


	/**
	 * API: FOR UNIT TEST ONLY
	 */
/*
	this.waitState = function(vmname, desiredState, timeoutMs, callback) { prvWaitForState(vmname, desiredState, timeoutMs, callback); };
*/

	/**
	 * Private: Helper function returns the openstack flavor for the device.
	 */
	var prvGetFlavor = function(blob) {
		var m = "prvGetFlavor";
		// Check for a 'device' object inside the blob.
		var key = 'device';
		if (blob.hasOwnProperty(key)) {
			var device = blob[key];
			// Check for a flavor inside the device.
			key = 'openstack-flavor';
			if (device.hasOwnProperty(key)) {
				var flavor = device[key];
				tr.log(5,m,"Exit. Returning specified flavor: " + flavor);
				return flavor;
			}
		}
		tr.log(5,m,"Exit. Returning default flavor: " + OS_FLAVOR_DEFAULT);
		return OS_FLAVOR_DEFAULT;
	}


	/**
	 * Private: Wait for VM status to become active then associate floating IP.
	 * NOTE: Long wait and associate are locked in the python.
	 */
	var prvWaitActiveAndAssociate = function(vmname, callback) {
		var m = "prvWaitActiveAndAssociate";
		tr.log(5,m,"Entry. vmname=" + vmname);

		// Serialize waiting for active and associating floating IP together
		floatSync.enter(function() {
			// Associate floating IP with the VM instance.
			var cmd = "python " + OPSTX_PYTHON_FILENAME + " associate " + vmname;
			tr.log(5,m,"Running cmd: " + cmd);
			proc.exec(cmd, function (err, stdout, stderr) {
				var m = 'associateCallback';
				tr.log(5,m,"Entry. err=" + err);
				tr.log(5,m,stdout);
				if (err) {
					var msg = "ERROR. Error associating IP to VM " + vmname;
					tr.log(5,m,msg);
	
					// recovery: terminate
					tr.log(5,m,"Attempting to terminate VM " + vmname + ". Ignoring all errors.");
					var ignoreErrors = true;
					prvTerminate(vmname, ignoreErrors, function(err,rspObj) {
						floatSync.exit();
						// ignore callback response; return prior error message.
						return callback(msg);
					});
				}
				var msg = "Associated IP with VM " + vmname;
				tr.log(5,m,msg);
				floatSync.exit();
				return callback(null,{"rc": 0, "msg": msg });
			});
		});
	}

	/**
	 * Private: Launch a VM and associate a floating IP with it.
	 */
	var prvLaunch = function(vmname, snapshotname, blob, callback) {
		var m = "prvLaunch";
		tr.log(5,m,"Entry. vmname=" + vmname + " snapshotname=" + snapshotname);

		// check dependency
		if (!fs.existsSync(OPSTX_PYTHON_FILENAME)) {
			var err = "ERROR: File OPSTX_PYTHON_FILENAME: " + OPSTX_PYTHON_FILENAME + " does not exist.";
			tr.log(0,m,err);
			return callback(err);
		}

		// Get the flavor
		var flavor = prvGetFlavor(blob);

		// boot VM
		opstx.bootVM(vmname, flavor, snapshotname, OS_KEY_NAME, function(err, rspObj) {
			var m = "bootCallback";
			if (err) return callback(err);
			if (0 != rspObj.rc) return callback(null,rspObj);

			// sleep
			tr.log(5,m,"Waiting a few seconds before associating floating IP...");
			var intervalId = setInterval(function() {
				clearInterval(intervalId);
				var m = "sleepCallback";

				if (true) {
					// Wait for VM to be active.
					var timeStop = new Date().getTime() + 360000; // 6 mins
					var desiredState = "ACTIVE";
					var returnOnError = "true";
					prvWaitForState(vmname, desiredState, timeStop, returnOnError, function(err,rspObj) {
						var m = "prvWaitForStateActiveCallback";
						tr.log(5,m,"Entry. err=" + util.inspect(err));
						tr.log(5,m,"rspObj: " + util.inspect(rspObj));
						if (err || null == rspObj || 0 != rspObj.rc || desiredState != rspObj.state) {
							var msg = "ERROR waiting for VM to become active. vmname=" + vmname + " state=" + rspObj.state + " Please check status again manually.";
							tr.log(5,m,msg);

							// Future: This is problematic. Low priority feature to debug and re-enable.
							// recovery: terminate
							//tr.log(5,m,"Attempting to terminate VM " + vmname + ". Ignoring all errors.");
							//var ignoreErrors = true;
							//prvTerminate(vmname, ignoreErrors, function(err,rspObj) {
							//	// ignore callback response; return prior error message.
							//	return callback(msg);
							//});

							return callback(msg);
						}
						tr.log(5,m,"Ok. VM " + vmname + " state is " + rspObj.state + ".");

						// Associate floating IP with VM.  (Note: The python also ensures that the VM is active.)
						prvWaitActiveAndAssociate(vmname, callback);
					});

				}
				else if (false) {
					// Serialize waiting for active and associating floating IP individually
					prvWaitActiveAndAssociate(vmname, callback);
				}
				else if (false) {
					// Serialize waiting for active and associating floating IP together
					floatSync.enter(function() {
						// Associate floating IP with the VM instance.
						var cmd = "python " + OPSTX_PYTHON_FILENAME + " associate " + vmname;
						tr.log(5,m,"Running cmd: " + cmd);
						proc.exec(cmd, function (err, stdout, stderr) {
							var m = 'associateCallback';
							tr.log(5,m,"Entry. err=" + err);
							tr.log(5,m,stdout);
							if (err) {
								var msg = "ERROR. Error associating IP to VM " + vmname;
								tr.log(5,m,msg);
	
								// recovery: terminate
								tr.log(5,m,"Attempting to terminate VM " + vmname + ". Ignoring all errors.");
								var ignoreErrors = true;
								prvTerminate(vmname, ignoreErrors, function(err,rspObj) {
									floatSync.exit();
									// ignore callback response; return prior error message.
									return callback(msg);
								});
							}
							var msg = "Associated IP with VM " + vmname;
							tr.log(5,m,msg);
							floatSync.exit();
							return callback(null,{"rc": 0, "msg": msg });
						});
					});
				}
				else {
					// This operation is performed asynchronously, inline with incoming web requests.
					// associate IP
					var cmd = "python " + OPSTX_PYTHON_FILENAME + " associate " + vmname;
					tr.log(5,m,"Running cmd: " + cmd);
					proc.exec(cmd, function (err, stdout, stderr) {
						var m = 'associateCallback';
						tr.log(5,m,"Entry. err=" + err);
						tr.log(5,m,stdout);
						if (err) {
							var msg = "ERROR. Error associating IP to VM " + vmname;
							tr.log(5,m,msg);

							// recovery: terminate
							tr.log(5,m,"Attempting to terminate VM " + vmname + ". Ignoring all errors.");
							var ignoreErrors = true;
							prvTerminate(vmname, ignoreErrors, function(err,rspObj) {
								// ignore callback response; return prior error message.
								return callback(msg);
							});
						}
						var msg = "Associated IP with VM " + vmname;
						tr.log(5,m,msg);
						return callback(null,{"rc": 0, "msg": msg });
					});
				}
			}, 6789);
		});

		tr.log(5,m,"Exit.");
	}


	/**
	 * Private: Terminate a VM.
	 */
	var prvTerminate = function(vmname, ignoreErrors, callback) {
		var m = "prvTerminate";
		tr.log(5,m,"Entry. vmname=" + vmname + " ignoreErrors=" + ignoreErrors);

		// check dependency
		if (!fs.existsSync(OPSTX_PYTHON_FILENAME)) {
			var err = "File OPSTX_PYTHON_FILENAME: " + OPSTX_PYTHON_FILENAME + " does not exist.";
			tr.log(0,m,err);
			return callback(err);
		}
		
		// deassociate IP
		var cmd = "python " + OPSTX_PYTHON_FILENAME + " deassociate " + vmname;
		tr.log(5,m,"Running cmd: " + cmd);
		proc.exec(cmd, function (err, stdout, stderr) {
			var m = 'terminateDeassociateCallback';
			tr.log(5,m,"Entry. err=" + util.inspect(err));
			tr.log(5,m,stdout);
			tr.log(5,m,"Entry.");
			if (err) {
				// AD 2014-0207: this old logic was backwards!
				// New logic:  Always ignore errors here and proceed to terminate
				if (false) { // ignoreErrors) {
					var msg = "ERROR deassociating IP from VM " + vmname + " err: " + util.inspect(err);
					tr.log(5,m,msg);
					return callback(err);
				} 
				else {
					var msg = "WARNING: Ignoring error deassociating IP from VM " + vmname + " err: " + util.inspect(err);
					tr.log(5,m,msg);
				}
			}
			// delete VM
			tr.log(5,m,"Deleting VM " + vmname);
			opstx.deleteVM(vmname, function(err, rspObj) {
				var m = "deleteVMCallback";
				tr.log(5,m,"Entry. err=" + util.inspect(err));
				if (err) return callback(err);
				tr.log(5,m,"rspObj: " + util.inspect(rspObj));
				if (0 != rspObj.rc) return callback(null,rspObj);
				
				// Wait
				var timeStop = new Date().getTime() + 34567;
				var returnOnError = "false";
				prvWaitForState(vmname, "NON_EXISTENT", timeStop, returnOnError, function(err,rspObj) {
					var m = "prvWaitForStateCallback";
					tr.log(5,m,"Entry. err=" + util.inspect(err));
					if (err) return callback(err);
					tr.log(5,m,"rspObj: " + util.inspect(rspObj));
					if (0 != rspObj.rc) return callback(null,rspObj);

					var msg = "Ok. Deleted VM " + vmname;
					tr.log(5,m,msg);
					return callback(null,{"rc": 0, "msg": msg });
				});
			});
		});

		tr.log(5,m,"Exit.");
	}


	/**
	 * Private:  Wait for desired VM state.
	 * Note: This function uses setTimeout and RECURSION!!!
	 */
	var prvWaitForState = function(vmname, desiredState, timeStop, returnOnError, callback) {
		var m = "prvWaitForState";
		tr.log(5,m,"Entry. vmname=" + vmname + " desiredState=" + desiredState + " timeStop=" + timeStop + " returnOnError=" + returnOnError);

		// get state
		// Note: this function returns 'BUILD' and 'ERROR' as well as 'ACTIVE' and 'PAUSED'.
		opstx.getDetailedVMState(vmname, function(err, rspObj) {
			var m = "prvWaitForStateCallback";
			var timeRemainingSec = (timeStop - (new Date().getTime())) / 1000;
			tr.log(5,m,"Entry. timeRemainingSec=" + timeRemainingSec + " err: ", err);
			if (err) return callback(err);
			tr.log(5,m,"rspObj: " + util.inspect(rspObj));
			if (0 != rspObj.rc) return callback(null,rspObj);

			var actualState = rspObj.state;
			tr.log(5,m,"actualState=" + actualState);

			// compare states
			if (desiredState == actualState) {
				var msg = "VM states are identical. vmname=" + vmname + " Returning actualState=" + actualState + " timeRemainingSec=" + timeRemainingSec;
				tr.log(5,m,msg);
				return callback(null,{"rc": 0, "state": actualState, "msg": msg });
			}

			// check state ERROR
			if ("true" == returnOnError) {
				if ("ERROR" == actualState) {
					var msg = "State is " + actualState;
					tr.log(5,m,msg);
					return callback(null,{"rc": -1, "state": actualState, "msg": msg });
				}
			}

			// check timeout
			if (new Date().getTime() > timeStop) {
				var msg = "Timeout expired. VM states are not identical. vmname=" + vmname + " desiredState=" + desiredState + " actualState=" + actualState + " timeRemainingSec=" + timeRemainingSec;
				tr.log(5,m,msg);
				return callback(null,{"rc": -1, "state": actualState, "msg": msg });
			}

			// wait again.  Call ourself RECURSIVELY!!!
			var msg = "File does not exist. Waiting again. VM states are not identical. vmname=" + vmname + " desiredState=" + desiredState + " actualState=" +  actualState + " timeRemainingSec=" + timeRemainingSec;
			tr.log(5,m,msg);
			// Note: Pass in the NAME of the function, timeoutMs, followed by args for the function.
			setTimeout( prvWaitForState, 3456, vmname, desiredState, timeStop, returnOnError, callback);
		});

		tr.log(5,m,"Exit.");
	}


	/**
	 * API: Lease.  Performs any required initialization.
	 *
	 * When a VM is leased using OpenStack, a new VM instance is launched.
	 */
	this.leaseVM = function(vmname, snapshotname, blob, callback) {
		var m = "leaseVM";
		tr.log(5,m,"Entry. vmname=" + vmname + " snapshotname=" + snapshotname);

		return callback(null,{"rc": 0, "msg": "Ok. Did nothing." });
	};


	/**
	 * API: Unlease.  Performs any required cleanup.
	 *
	 * When a VM is unleased using OpenStack, the VM is terminated.
	 */
	this.unleaseVM = function(vmname, blob, callback) {
		var m = "unleaseVM";
		tr.log(5,m,"Entry. vmname=" + vmname);

		// get state
		opstx.getVMState(vmname, function(err, rspObj) {
			var m = "unleaseVMCallback";
			tr.log(5,m,"Entry. err: ", err);
			if (err) return callback(err);
			tr.log(5,m,"rspObj: " + util.inspect(rspObj));
			if (0 != rspObj.rc) return callback(null,rspObj);

			var state = rspObj.state;
			tr.log(5,m,"state=" + state);

			// handle states
			if ("ACTIVE" == state) {
				var err = "ERROR: VM is active. VM=" + vmname + " state=" + state;
				tr.log(0,m,err);
				return callback(err);
			}
			else if ("PAUSED" == state) {
				tr.log(5,m,"VM " + vmname + " is paused. Terminating.");
				var ignoreErrors = false;  // Hmm, maybe should ignore errors and let the consumer be free?
				prvTerminate(vmname, ignoreErrors, callback);
			}
			else if ("NON_EXISTENT" == state) {
				var msg = "Unleased VM " + vmname + ". state=" + state;
				tr.log(5,m,msg);
				return callback(null,{"rc": 0, "msg": msg });
			}
			else {
				var err = "ERROR: VM state not recognized. VM=" + vmname + " state=" + state;
				tr.log(0,m,err);
				// AD 2014-0207-0730 - Do not return callback. Do call terminate.
				if (false) {
					return callback(err);
				}
				else {
					tr.log(0,m,"Calling Terminate with ignoreErrors=true vmname=" + vmname + " state=" + state + " =====");
					var ignoreErrors = true; 
					prvTerminate(vmname, ignoreErrors, callback);
				}
			}
		});
	};


	/**
	 * API: Indicates whether the VM is running.
	 */
	this.isRunning = function(vmname, blob, callback) {
		var m = "isRunning";
		tr.log(5,m,"Entry. vmname=" + vmname);

		opstx.isActive(vmname,callback);
	};


	/**
	 * API: Gets the IP address of the specified VM.
	 */
	this.getIP = function(vmname, blob, callback) {
		var m = "getIP";
		tr.log(5,m,"Entry. vmname=" + vmname);

		// check dependency
		if (!fs.existsSync(OPSTX_PYTHON_FILENAME)) {
			var err = "ERROR: File OPSTX_PYTHON_FILENAME: " + OPSTX_PYTHON_FILENAME + " does not exist.";
			tr.log(0,m,err);
			return callback(err);
		}

		// define python command
		var filename = "tmp/get.ip." + vmname + "." + uniqueString.getUniqueString();
		var cmd = "python " + OPSTX_PYTHON_FILENAME + " displayassociated " + vmname + " > " + filename;
		tr.log(5,m,"Running: " + cmd);

		// Execute command.
		proc.exec(cmd, function (err, stdout, stderr) {
			var m = 'getIPCallback';
			tr.log(5,m,"Entry. err: ", err);
			tr.log(5,m,"stdout:\n",stdout);
			tr.log(5,m,"stderr:\n",stderr);
			if (err) {
				var msg = "Could not find IP for VM " + vmname;
				tr.log(5,m,msg);
				return callback(null,{"rc": 0, "ip": "", "msg": msg });
			}

			// read the contents of the response from file.
			var line;
			var fileContentsString = fs.readFileSync( filename, 'utf8');
			tr.log(5,m,"fileContentsString: >>>" + fileContentsString + "<<<");

			// Delete the tmp file.
			fs.unlinkSync(filename);

			var fileContentsList = fileContentsString.split("\n");
			tr.log(5,m,"fileContentsList.length=" + fileContentsList.length);
			for (var i=0; i<fileContentsList.length; i++) {
				line = fileContentsList[i];
				console.log("line: " + line);

				// search for 'OPSTX7832I'
				if (-1 < line.indexOf("OPSTX7832I")) {
					tr.log(5,m,"Found response: " + line);
					break;
				}
			}

			if (!line) {
				var msg = "Did not find IP for VM " + vmname;
				tr.log(5,m,msg);
				return callback(null,{"rc": 0, "ip": "", "msg": msg });
			}
			else {
				tr.log(5,m,"Parsing line: >>>" + line + "<<<");
				var opstx7832i = JSON.parse(line);
				tr.log(5,m,"opstx7832i: " + util.inspect(opstx7832i));
				if ("ip" in opstx7832i) {
					var ip = opstx7832i.ip;
					var msg = "Returning IP for VM " + vmname + " ip=" + ip;
					tr.log(5,m,msg);
					return callback(null,{"rc": 0, "ip": ip, "msg": msg });
				}
				else {
					var msg = "Response not contain IP for VM " + vmname;
					tr.log(5,m,msg);
					return callback(null,{"rc": 0, "ip": "", "msg": msg });
				}
			}
		});
	};


	/**
	 * API: Restores snapshot.
	 * 
	 * When a VM is restored using OpenStack,
	 * the old VM is terminated, and a new VM is launched.
	 */
	this.restoreVM = function(vmname, snapshotname, blob, callback) {
		var m = "restoreVM";
		tr.log(5,m,"Entry. vmname=" + vmname + " snapshotname=" + snapshotname);

		// get state
		opstx.getVMState(vmname, function(err, rspObj) {
			var m = "restoreVMCallback";
			tr.log(5,m,"Entry. err: ", err);
			if (err) return callback(err);
			tr.log(5,m,"rspObj: " + util.inspect(rspObj));
			if (0 != rspObj.rc) return callback(null,rspObj);

			var state = rspObj.state;
			tr.log(5,m,"state=" + state);

			// handle states
			if ("ACTIVE" == state) {
				var err = "ERROR: VM is active. VM=" + vmname + " state=" + state;
				tr.log(0,m,err);
				return callback(err);
			}
			else if ("PAUSED" == state) {
				tr.log(5,m,"VM " + vmname + " is paused. Terminating and restoring.");
				var ignoreErrors = false;
				prvTerminate(vmname, ignoreErrors, callback);
			}
			else if ("NON_EXISTENT" == state) {
				var msg = "VM " + vmname + " is already restored.";
				tr.log(5,m,msg);
				return callback(null,{"rc": 0, "msg": msg });
			}
			else {
				var err = "ERROR: VM state not recognized. VM=" + vmname + " state=" + state;
				tr.log(0,m,err);
				return callback(err);
			}
		});
	};


	/**
	 * API: Starts the specified VM.
	 *
	 * When a VM is started using OpenStack, the VM is unpaused.
	 */
	this.startVM = function(vmname, snapshotname, blob, callback) {
		var m = "startVM";
		tr.log(5,m,"Entry. vmname=" + vmname + " snapshotname=" + snapshotname);
		tr.log(5,m,"blob: " + util.inspect(blob));


		// get state
		opstx.getVMState(vmname, function(err, rspObj) {
			var m = "startVMCallback";
			tr.log(5,m,"Entry. err: ", err);
			if (err) return callback(err);
			tr.log(5,m,"rspObj: " + util.inspect(rspObj));
			if (0 != rspObj.rc) return callback(null,rspObj);

			var state = rspObj.state;
			tr.log(5,m,"state=" + state);

			// handle states
			if ("ACTIVE" == state) {
				var msg = "VM " + vmname + " is already started.";
				tr.log(5,m,msg);
				return callback(null,{"rc": 0, "msg": msg });
			}
			else if ("PAUSED" == state) {
				tr.log(5,m,"VM " + vmname + " is paused. Unpausing.");
				return opstx.unpauseVM(vmname, callback);
			}
			else if ("NON_EXISTENT" == state) {
				tr.log(5,m,"Launching new VM " + vmname + " snapshotname=" + snapshotname);
				prvLaunch(vmname, snapshotname, blob, callback);
			}
			else {
				var err = "ERROR: VM state not recognized. VM=" + vmname + " state=" + state;
				tr.log(0,m,err);
				return callback(err);
			}
		});
	};


	/**
	 * API: Stops the specified VM.
	 *
	 * When a VM is stopped using OpenStack, the VM is paused.
	 */
	this.stopVM = function(vmname, blob, callback) {
		var m = "stopVM";
		tr.log(5,m,"Entry. vmname=" + vmname);

		// get state
		opstx.getVMState(vmname, function(err, rspObj) {
			var m = "stopVMCallback";
			tr.log(5,m,"Entry. err: ", err);
			if (err) return callback(err);
			tr.log(5,m,"rspObj: " + util.inspect(rspObj));
			if (0 != rspObj.rc) return callback(null,rspObj);

			var state = rspObj.state;
			tr.log(5,m,"state=" + state);

			// handle states
			if ("ACTIVE" == state) {
				tr.log(5,m,"VM " + vmname + " is active. Pausing.");
				opstx.pauseVM(vmname, function(err,rspObj) {
					if (err) return callback(err);

					// Wait for VM to be paused.
					var timeStop = new Date().getTime() + 60000; // 1 min
					var desiredState = "PAUSED";
					var returnOnError = "false";
					prvWaitForState(vmname, desiredState, timeStop, returnOnError, function(err,rspObj) {
						var m = "prvWaitForStatePausedCallback";
						tr.log(5,m,"Entry. err=" + util.inspect(err));
						tr.log(5,m,"rspObj: " + util.inspect(rspObj));
						if (err || null == rspObj || 0 != rspObj.rc || desiredState != rspObj.state) {
							var msg = "ERROR. Timeout expired waiting for VM to stop. vmname=" + vmname + " Please check status again manually.";
							tr.log(5,m,msg);
							return callback(msg);
						}
						var msg = "Ok. VM " + vmname + " state is " + rspObj.state + ".";
						tr.log(5,m,msg);
						return callback(null,{"rc": 0, "msg": msg });
					});
				});
			}
			else {
				var msg = "VM " + vmname + " is not active.";
				tr.log(5,m,msg);
				return callback(null,{"rc": 0, "msg": msg });
			}
		});
	};


	/**
	 * API: Takes snapshot.
	 */
	this.takeSnapshot = function(vmname, snapshotname, blob, callback) {
		var m = "takeSnapshot";
		tr.log(5,m,"Entry. vmname=" + vmname + " snapshotname=" + snapshotname);

		return callback("SORRY opstx.takeSnapshot() is not implemented yet.");
	};


	/**
	 * API: Renames snapshot.
	 */
	this.renameSnapshot = function(vmname, srcsnapshotname, dstsnapshotname, blob, callback) {
		var m = "renameSnapshot";
		tr.log(5,m,"Entry. vmname=" + vmname + " srcsnapshotname=" + srcsnapshotname + " dstsnapshotname=" + dstsnapshotname);

		return callback("SORRY opstx.renameSnapshot() is not implemented yet.");
	};
};

module.exports = OpenStackHypervisor;

