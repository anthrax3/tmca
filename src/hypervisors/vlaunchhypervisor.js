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
 * This class provides the connection to a vLaunch hypervisor.
 *
 * This class implements the faux interface for hypervisor classes, ihypervisor.js
 * 
 * All callbacks returns (err, responseObject) 
 *    where responseObject contains int rc, boolean running, and string msg.  
 * Example:
 *    return callback(null,{"rc": 0, "msg": "Started VM successfully." });
 *
 * AD 2014-1012-1156
 */
var Tr = require('./../tr.js');
var dns = require('dns');
var needle = require('needle');
var util = require('util');
var KitchenSync = require('./../kitchensync.js');

var VLaunchHypervisor = function(blob) {

	var hypervisor = blob.hypervisor;
    var name = hypervisor.name;
	var domain = hypervisor.domain;
	var tr = new Tr(name, 5, "log.txt");

	var VLAUNCH_TOKEN = "undefined";
	var vLaunchURL = "https://vlaunch.rtp.raleigh.ibm.com:443/api/v1";
	var vmDict = {};

	var deviceSyncBlocks = {};

	// Define timeouts
	var TIMEOUT_RESTORE_MS = 60000;  // 1 minute
	var TIMEOUT_POWER_ON_MS = 120000;  // 2 minutes
	var TIMEOUT_POWER_OFF_MS = 180000;  // 3 minutes
	var TIMEOUT_POLL_MS = 3456;  // 3+ seconds
	
	// Define constants for HTTP response codes.
	var POST_SUCCESS = 201;
	var GET_SUCCESS = 200;


	/**
 	 * Init: Assimilate environment variables.
	 */
	var errenv = function(missingVarName) {
		console.log("ERROR: Please set environment variable: " + missingVarName);
		process.exit(1);
	}
	var pe = process.env;
	if (pe.VLAUNCH_TOKEN) { VLAUNCH_TOKEN = pe.VLAUNCH_TOKEN; } else { errenv("VLAUNCH_TOKEN"); }


	/**
	 * Private: Gets a sync block object for the specified device.
	 * One sync block object is stored for each device.
	 * Operations for each device are serialized.
	 */
	var getSyncBlock = function(vmname) {
		var m = "getSyncBlock/" + vmname;
		tr.log(5,m,"Entry. vmname=" + vmname);

		if (deviceSyncBlocks.hasOwnProperty(vmname)) {
			var syncBlock = deviceSyncBlocks[vmname];
			tr.log(5,m,"Exit. Returning existing sync block for vmname " + vmname);
			return syncBlock;
		}

		var syncBlock = new KitchenSync(vmname);
		deviceSyncBlocks[vmname] = syncBlock;
		tr.log(5,m,"Exit. Returning new sync block for vmname " + vmname);
		return syncBlock;
	};

	/**
	 * Private: Gets the vLaunch token for the specified VM name.
	 */
	var getVLaunchToken = function(blob) {
		var m = "getVLaunchToken";
		tr.log(5,m,"Entry.");

		// Default
		var vLaunchToken = VLAUNCH_TOKEN;

		var device = blob['device'];
		tr.log(5,m,"From blob: deviceName=" + device['name']);

		if (blob.hasOwnProperty('deviceowner')) {
			var deviceowner = blob['deviceowner'];
			if (deviceowner.hasOwnProperty('vlaunchtoken')) {	
				vLaunchToken = deviceowner['vlaunchtoken'];
				tr.log(5,m,"Found token.");
				console.log(vLaunchToken);
			}
			else {
				tr.log(5,m,"WARNING: device owner does not have vLaunchToken. Returning default token.");
			}
		}
		else {
			tr.log(5,m,"Device owner not specified in blob. Returning default token.");
		}

		tr.log(5,m,"Exit. Returning vLaunchToken=" + vLaunchToken);	
		return vLaunchToken;
	};


	/**
	 * Private: Indicates whether the VM is running.
	 *
	 * Callback returns (err, responseObject) 
	 *    where responseObject contains int rc, boolean running, and string msg.  
	 */
	var isVMRunning = function(vmname, token, callback) {
		var m = "isVMRunning/" + vmname;
		tr.log(5,m,"Entry. vmname=" + vmname);

		getVMByName(vmname, token, function(err,vmObject) {
			var m = "isVMRunning/getVMByNameCb";
			tr.log(5,m,"Entry.");
			if (err) { return callback(err); }
			//tr.log(5,m,"vm: " + util.inspect(vmObject));

			var power_state = vmObject['power_state'];
			if ("poweredOn" == power_state) {
				tr.log(5,m,"Exit. vmname=" + vmname + " power_state=" + power_state + " Returning running.");
				return callback(null,{"rc": 0, "running": true, "msg": "VM is running." });
			}
			else {
				tr.log(5,m,"Exit. vmname=" + vmname + " power_state=" + power_state + " Returning stopped.");
				return callback(null,{"rc": 0, "running": false, "msg": "VM is stopped." });
			}
		});
	};


	/**
	 * Private: Get current information about a VM. 
	 * Returns VM object.
	 */
	var getVMByID = function(vmid, token, callback) {
		var m = "getVMByID";
		tr.log(5,m,"Entry. vmid=" + vmid);

		// Prepare request
		var url = vLaunchURL + "/vms/" + vmid;
		var headers = { "Authorization": "Token token=" + token };
		var options = {
			"headers": headers,
			"rejectUnauthorized": false
		};

		// Send request
		var eyecatcher = "get-vm-" + vmid;
		tr.log(5,m,"Issuing request to vLaunch: " + eyecatcher);
		needle.get(url, options, function(err, resp, body) {
			var m = "getVMByID/needleGetCb";
			tr.log(5,m,"Entry.");
			/*
			console.log("----err----");
			console.log(err);
			console.log("----resp----");
			console.log(resp);
			console.log("----body---");
			console.log(body);
			*/

			if (err) { return callback(err); }

			var vmObject = body;
			tr.log(5,m,"Returning VM object.");
			return callback(err,vmObject);
		});

		tr.log(5,m,"Exit.");
	};


	/**
	 * Private: Get current information about a VM. 
	 * Returns VM object.
	 */
	var getVMByName = function(vmname, token, callback) {
		var m = "getVMByName/" + vmname;
		tr.log(5,m,"Entry. vmname=" + vmname);

		// Convert VM name to ID
		getVMID(vmname, token, function(err,vmid) {
			var m = "getVMByName/getVMIDCb";
			tr.log(5,m,"Entry.");
			if (err) { return callback(err); }
			tr.log(5,m,"vmid=" + vmid);

			// Get information about the VM.
			getVMByID(vmid, token, function(err,vmObject) {
				var m = "getVMByName/getVMIDCb/getVMByIDCb";
				tr.log(5,m,"Entry.");
				if (err) { return callback(err); }
				tr.log(5,m,"Exit. Returning VM object for vm: " + vmname + " " + vmid);
				return callback(null, vmObject);
			});
		});
	};


	/**
	 * Gets information about each VM known by the vLaunch service.
	 */
	var getVMList = function(token, callback) {
		var m = "getVMList";
		tr.log(5,m,"Entry.");

		// Prepare request
		var url = vLaunchURL + "/vms";
		var headers = { "Authorization": "Token token=" + token };
		var options = {
			"headers": headers,
			"rejectUnauthorized": false
		};

		// Send request
		var eyecatcher = "get-vm-list";
		tr.log(5,m,"Issuing request to vLaunch: " + eyecatcher);
		needle.get(url, options, function(err, resp, body) {
			var m = "getVMList/needleGetCb";
			tr.log(5,m,"Entry.");
			/*
			console.log("----err----");
			console.log(err);
			console.log("----resp----");
			console.log(resp);
			console.log("----body---");
			console.log(body);
			*/

			if (err) { return callback(err); }

			var statusCode = resp['statusCode'];
			tr.log(5,m,"statusCode=" + statusCode);
			if (GET_SUCCESS != statusCode) { return callback("ERROR: Could not get VM list. statusCode=" + statusCode); }

			// Extract new data
			var newDict = {};
			var vmList = body;
			for (var i=0; i<vmList.length; i++) {
				var vm = vmList[i];
				var vmid = vm['id'];
				var vmname = vm['vmname'];
				var vmObject = { "name": vmname, "vmid": vmid };  // yes, redundant
				newDict[vmname] = vmObject;
			}

			// Swap
			vmDict = newDict;

			tr.log(5,m,"Assimilated " + vmList.length + " VMs.");
			tr.log(5,m,util.inspect(vmDict));
			return callback(null);
		});		
	};


	/**
	 * Gets the VM ID associated with a VM name either from vLaunch or from a cached table.
	 */
	var getVMID = function(vmname, token, callback) {
		var m = "getVMID/" + vmname;
		tr.log(5,m,"Entry. vmname=" + vmname);

		// Check cached list of VMs
		if (vmDict.hasOwnProperty(vmname)) {
			var vm = vmDict[vmname];
			var vmid = vm['vmid'];
			tr.log(5,m,"Exit. Found cached vmid for vmname " + vmname + ". Returning vmid=" + vmid);
			return callback(null, vmid);
		}

		// Get new list of VMs
		tr.log(5,m,"VM name " + vmname + " not found in cache. Getting new list of VMs.");
		getVMList(token, function(err) {
			var m = "getVMID/getVMListCb";
			if (err) { return callback(err); }
			if (vmDict.hasOwnProperty(vmname)) {
				var vm = vmDict[vmname];
				var vmid = vm['vmid'];
				tr.log(5,m,"Exit. Fetched new VM list. Returning vmid=" + vmid + " for vm " + vmname);
				return callback(null, vmid);
			}
			return callback("ERROR: Could not find VM " + vmname + " in VMList.");
		});
	};
	

	/**
	 * Private: Get status of a work request.
	 */
	var getWorkRequestStatus = function(workRequestID, token, callback) {
		var m = "getWorkRequestStatus";
		tr.log(5,m,"Entry. workRequestID=" + workRequestID);

		// Prepare request
		var url = vLaunchURL + "/requests/" + workRequestID;
		var headers = { "Authorization": "Token token=" + token };
		var options = {
			"headers": headers,
			"rejectUnauthorized": false
		};

		// Send request
		var eyecatcher = "get-request-" + workRequestID;
		tr.log(5,m,"Issuing request to vLaunch: " + eyecatcher);
		needle.get(url, options, function(err, resp, body) {
			var m = "getWorkRequestStatus/needleGetCb";
			tr.log(5,m,"Entry.");
			/*
			console.log("----err----");
			console.log(err);
			console.log("----resp----");
			console.log(resp);
			console.log("----body---");
			console.log(body);
			*/

			if (err) { return callback(err); }

			var statusCode = resp['statusCode'];
			tr.log(5,m,"workRequestID=" + workRequestID + " statusCode=" + statusCode);
			if (GET_SUCCESS != statusCode) { return callback("ERROR: statusCode=" + statusCode); }

			var workRequestStatus = body['status'];
			tr.log(5,m,"workRequestworkRequestID=" + workRequestID + " workRequestStatus=" + workRequestStatus);

			return callback(null,{"rc": 0, "workRequestStatus": workRequestStatus, "msg": "ok" });
		});

		tr.log(5,m,"Exit.");
	};



	/**
	 * Private: Get list of work requests which are not completed.
	 */
	var getOpenWorkRequests = function(vmid, token, callback) {
		var m = "getOpenWorkRequests";
		tr.log(5,m,"Entry. vmid=" + vmid);

		// Prepare request
		// Exclude completed requests
		var url = vLaunchURL + "/requests/?q[vm_id_eq]=" + vmid + "&q[status_not_eq]=Completed"
		var headers = { "Authorization": "Token token=" + token };
		var options = {
			"headers": headers,
			"rejectUnauthorized": false
		};

		// Send request
		var eyecatcher = "get-incomplete-requests-vmid-" + vmid;
		tr.log(5,m,"Issuing request to vLaunch: " + eyecatcher);
		needle.get(url, options, function(err, resp, body) {
			var m = "getOpenWorkRequests/needleGetCb";
			tr.log(5,m,"Entry.");
			/*
			console.log("----err----");
			console.log(err);
			console.log("----resp----");
			console.log(resp);
			console.log("----body---");
			console.log(body);
			*/

			if (err) { return callback(err); }

			var statusCode = resp['statusCode'];
			tr.log(5,m,"vmid=" + vmid + " statusCode=" + statusCode);
			if (GET_SUCCESS != statusCode) { return callback("ERROR: statusCode=" + statusCode); }

			var workRequestList = body;
			tr.log(5,m,"len(workRequestList)=" + workRequestList.length);

			// Exclude canceled requests
			var openRequests = [];
			for (var i=0; i<workRequestList.length; i++) {
				var workRequest = workRequestList[i];
				var status = workRequest['status'];
				tr.log(5,m,"status=" + status);
				if ("Canceled" != status) {
					openRequests.push(workRequest);
				}
			}

			tr.log(5,m,"Exit. Returning " + openRequests.length + " requests for vmid " + vmid);
			return callback(null,openRequests);
		});

		tr.log(5,m,"Exit.");
	};



	/**
	 * Private:  Wait for desired work request status.
	 * Note: This function uses setTimeout and RECURSION!!!
	 * IMPORTANT: If you add an arg here, you must add it below where recursion calls itself.
	 */
	var waitWorkRequestStatus = function(workRequestID, desiredStatus, token, eyecatcher, timeStop, returnOnError, callback) {
		var m = "waitWorkRequestStatus/" + eyecatcher;
		tr.log(5,m,"Entry. workRequestID=" + workRequestID + " eyecatcher=" + eyecatcher + " desiredStatus=" + desiredStatus + " timeStop=" + timeStop + " returnOnError=" + returnOnError);

		// get status
		getWorkRequestStatus(workRequestID, token, function(err, rspObj) {
			var m = "waitWorkRequestStatus/getWorkRequestStatusCb";
			var timeRemainingSec = (timeStop - (new Date().getTime())) / 1000;
			tr.log(5,m,"Entry. timeRemainingSec=" + timeRemainingSec + " err: ", err);
			if (err) return callback(err);
			tr.log(5,m,"rspObj: " + util.inspect(rspObj));
			if (0 != rspObj.rc) return callback(null,rspObj);

			var actualStatus = rspObj.workRequestStatus;
			tr.log(5,m,"actualStatus=" + actualStatus);

			// compare statuses
			if (desiredStatus == actualStatus) {
				var msg = "Work request statuses are identical. workRequestID=" + workRequestID + " eyecatcher=" + eyecatcher + " Returning actualStatus=" + actualStatus + " timeRemainingSec=" + timeRemainingSec;
				tr.log(5,m,msg);
				return callback(null,{"rc": 0, "status": actualStatus, "msg": msg });
			}

			// check status ERROR
			if ("true" == returnOnError) {
				// TODO Fix error string. Abandoned?
				if ("ERROR" == actualStatus) {
					var msg = "Status is " + actualStatus;
					tr.log(5,m,msg);
					return callback(null,{"rc": -1, "status": actualStatus, "msg": msg });
				}
			}

			// check timeout
			if (new Date().getTime() > timeStop) {
				var msg = "ERROR: Timeout expired. Work request statuses are not identical. workRequestID=" + workRequestID + " eyecatcher=" + eyecatcher + " desiredStatus=" + desiredStatus + " actualStatus=" + actualStatus + " timeRemainingSec=" + timeRemainingSec;
				tr.log(5,m,msg);
				return callback(msg);
			}

			// wait again.  Call ourself RECURSIVELY!!!
			var msg = "Waiting again. Work request statuses are not identical. workRequestID=" + workRequestID + " eyecatcher=" + eyecatcher + " desiredStatus=" + desiredStatus + " actualStatus=" + actualStatus + " timeRemainingSec=" + timeRemainingSec;
			tr.log(5,m,msg);
			// Note: Pass in the NAME of this function, timeoutMs, followed by args for the function.
			setTimeout( waitWorkRequestStatus, TIMEOUT_POLL_MS, workRequestID, desiredStatus, token, eyecatcher, timeStop, returnOnError, callback);
		});

		tr.log(5,m,"Exit.");
	}



	/**
	 * Private: Powers on or off the VM.  action=on|off
	 *
	 * Note: This function works fine to power on VMs, but powering off can take up to 16 minutes if
	 * vLaunch can not talk to the VMWare tools app running on the VM.  
	 * For best results, I recommend using setPowerOffForce, which basically pulls out the power cord.
	 */
	var setPower = function(vmname, action, token, timeoutMs, callback) {
		var m = "setPower/" + vmname;
		tr.log(5,m,"Entry. vmname=" + vmname + " action=" + action + " timeoutMs=" + timeoutMs);

		// Check arg
		if ("on" != action && "off" != action) { return callback("ERROR: Specify action=on|off. Invalid value=" + action); }

		// Convert VM name to ID
		getVMID(vmname, token, function(err,vmid) {
			var m = "setPower/getVMIDCb";
			tr.log(5,m,"Entry.");
			if (err) { return callback(err); }
			tr.log(5,m,"vmid=" + vmid);

			// Ensure no requests are pending for this VM
			getOpenWorkRequests(vmid, token, function(err,openRequests) {
				var m = "setPower/getVMIDCb/getOpenWorkRequestsCb";
				tr.log(5,m,"Entry.");
				if (err) { return callback(err); }

				var numOpenRequests = openRequests.length;
				tr.log(5,m,"numOpenRequests=" + numOpenRequests);
				if (0 < numOpenRequests) { return callback("Sorry, this VM has another request pending."); }

				// Check if VM is already in desired state
				isVMRunning(vmname, token, function(err,rspObj) {
					var m = "setPower/getVMIDCb/getOpenWorkRequestsCb/isVMRunningCb1";
					if (err) { return callback(err); }
					var running = rspObj['running'];
					tr.log(5,m,"Entry. vmname=" + vmname + " action=" + action + " running=" + running);
					if ("on" == action && running) { 
						var msg = "VM " + vmname + " is already powered on.";
						tr.log(5,m,msg);
						return callback(null,{"rc": 0, "msg": msg });
					}
					if ("off" == action && !running) { 
						var msg = "VM " + vmname + " is already powered off.";
						tr.log(5,m,msg);
						return callback(null,{"rc": 0, "msg": msg });
					}

					// Prepare request
					var url = vLaunchURL + "/actions/power" + action;
					var payload = { "vm_id": vmid, "force": 1 };
					var headers = { "Authorization": "Token token=" + token };
					var options = {
						"headers": headers,
						rejectUnauthorized: false,
						json: true
					};

					// Send request
					var eyecatcher = "power-" + action + "-" + vmname;
					tr.log(5,m,"Issuing request to vLaunch: " + eyecatcher);
					needle.post(url, payload, options, function(err, resp, body) {
						var m = "setPower/getVMIDCb/getOpenWorkRequestsCb/isVMRunningCb1/needlePostCb";
						tr.log(5,m,"Entry. vmname=" + vmname + " action=" + action);
						/*
						console.log("----err---");
						console.log(err);
						console.log("----resp---");
						console.log(resp);
						console.log("----body---");
						console.log(body);
						*/
						if (err) { return callback(err); }

						var statusCode = resp['statusCode'];
						tr.log(5,m,"vmname=" + vmname + " action=" + action + " statusCode=" + statusCode);
						if (POST_SUCCESS != statusCode) { return callback("ERROR: statusCode=" + statusCode); }

						var workRequestID = body['id'];
						tr.log(5,m,"vmname=" + vmname + " action=" + action + " workRequestID=" + workRequestID);

						// Wait for completion.
						var timeStop = new Date().getTime() + timeoutMs;
						waitWorkRequestStatus(workRequestID, "Completed", token, eyecatcher, timeStop, "true", callback);
					});
				});
			});
		});

		tr.log(5,m,"Exit.");
	};


	/**
	 * Private: Forces power off on the VM.
	 *
	 * Note: This function basically pulls out the power cord out of the VM.  
	 * Beware: Disk contents may be corrupted.
	 */
	var setPowerOffForce = function(vmname, action, token, timeoutMs, callback) {
		var m = "setPowerOffForce/" + vmname;
		tr.log(5,m,"Entry. vmname=" + vmname + " action=" + action + " timeoutMs=" + timeoutMs);

		// Check arg
		if ("on" != action && "off" != action) { return callback("ERROR: Specify action=on|off. Invalid value=" + action); }

		// Convert VM name to ID
		getVMID(vmname, token, function(err,vmid) {
			var m = "setPowerOffForce/getVMIDCb";
			tr.log(5,m,"Entry.");
			if (err) { return callback(err); }
			tr.log(5,m,"vmid=" + vmid);

			// Ensure no requests are pending for this VM
			getOpenWorkRequests(vmid, token, function(err,openRequests) {
				var m = "setPowerOffForce/getVMIDCb/getOpenWorkRequestsCb";
				tr.log(5,m,"Entry.");
				if (err) { return callback(err); }

				var numOpenRequests = openRequests.length;
				tr.log(5,m,"numOpenRequests=" + numOpenRequests);
				if (0 < numOpenRequests) { return callback("Sorry, this VM has another request pending."); }

				// Check if VM is already in desired state
				isVMRunning(vmname, token, function(err,rspObj) {
					var m = "setPowerOffForce/getVMIDCb/getOpenWorkRequestsCb/isVMRunningCb2";
					if (err) { return callback(err); }
					var running = rspObj['running'];
					tr.log(5,m,"Entry. vmname=" + vmname + " action=" + action + " running=" + running);
					if ("off" == action && !running) { 
						var msg = "VM " + vmname + " is already powered off.";
						tr.log(5,m,msg);
						return callback(null,{"rc": 0, "msg": msg });
					}

					// Prepare request
					var url = vLaunchURL + "/requests";
					var payload = { "workflow_id": 128, "vm_id": vmid };
					var headers = { "Authorization": "Token token=" + token };
					var options = {
						"headers": headers,
						rejectUnauthorized: false,
						json: true
					};

					// Send request
					var eyecatcher = "power-off-force-" + vmname;
					tr.log(5,m,"Issuing request to vLaunch: " + eyecatcher);
					needle.post(url, payload, options, function(err, resp, body) {
						var m = "setPowerOffForce/getVMIDCb/getOpenWorkRequestsCb/isVMRunningCb2/needlePostCb";
						tr.log(5,m,"Entry. vmname=" + vmname + " action=" + action);
						/*
						console.log("----err---");
						console.log(err);
						console.log("----resp---");
						console.log(resp);
						console.log("----body---");
						console.log(body);
						*/
						if (err) { return callback(err); }

						var statusCode = resp['statusCode'];
						tr.log(5,m,"vmname=" + vmname + " action=" + action + " statusCode=" + statusCode);
						if (POST_SUCCESS != statusCode) { return callback("ERROR: statusCode=" + statusCode); }

						var workRequestID = body['id'];
						tr.log(5,m,"vmname=" + vmname + " action=" + action + " workRequestID=" + workRequestID);

						// Wait for completion.
						var timeStop = new Date().getTime() + timeoutMs;
						waitWorkRequestStatus(workRequestID, "Completed", token, eyecatcher, timeStop, "true", callback);
					});
				});
			});
		});

		tr.log(5,m,"Exit.");
	};



	//------------------------------------------------------------------

	/**
	 * API: Returns name of this class. Useful for setup and debug.
	 */
	this.getName = function() {
		var m = "getName";
		tr.log(5,m,"Entry. Returning name=" + name);
		return name;
    };


	/**
	 * API: Lease.  Performs any required initialization.
	 */
	this.leaseVM = function(vmname, snapshotname, blob, callback) {
		return callback(null,{"rc": 0, "msg": "Ok. Did nothing." });
	};


	/**
	 * API: Unlease.  Performs any required cleanup.
	 */
	this.unleaseVM = function(vmname, blob, callback) {
		return callback(null,{"rc": 0, "msg": "Ok. Did nothing." });
	};


	/**
	 * API: Indicates whether the VM is running.
	 *
	 * Callback returns (err, responseObject) 
	 *    where responseObject contains int rc, boolean running, and string msg.  
	 */
	this.isRunning = function(vmname, blob, callback) {
		var m = "isRunning/" + vmname;
		tr.log(5,m,"Entry. vmname=" + vmname);

		var token = getVLaunchToken(blob);

		var syncBlock = getSyncBlock(vmname);

		tr.log(5,m,"Trying sync block. vmname=" + vmname + " syncBlock=" + syncBlock.getName());
		syncBlock.enter(function() {
			tr.log(5,m,"Entered sync block: " + syncBlock.getName());
			isVMRunning(vmname, token, function(err,responseObject) {
				var m = "isRunning/isVMRunningCb";

				tr.log(5,m,"Entry. Leaving sync block: " + syncBlock.getName());
				syncBlock.exit();

				if (responseObject) {
					tr.log(5,m,"Exit. Returning responseObject.");
					return callback(err,responseObject);
				}
				tr.log(5,m,"Exit. Returning err.");
				return callback(err);
			});
		});

		tr.log(5,m,"Exit.");
	};


	/**
	 * API: Restores snapshot.
	 */
	this.restoreVM = function(vmname, snapshotname, blob, callback) {
		var m = "restoreVM/" + vmname;
		tr.log(5,m,"Entry. vmname=" + vmname + " snapshotname=" + snapshotname);

		var syncBlock = getSyncBlock(vmname);

		tr.log(5,m,"Trying sync block. vmname=" + vmname + " syncBlock=" + syncBlock.getName());
		syncBlock.enter(function() {
			tr.log(5,m,"Entered sync block: " + syncBlock.getName());
			prvRestoreVM(vmname, snapshotname, blob, function(err,responseObject) {
				var m = "restoreVM/prvRestoreVMCb";

				tr.log(5,m,"Entry. Leaving sync block: " + syncBlock.getName());
				syncBlock.exit();

				if (responseObject) {
					tr.log(5,m,"Exit. Returning responseObject.");
					return callback(err,responseObject);
				}
				tr.log(5,m,"Exit. Returning err.");
				return callback(err);
			});
		});

		tr.log(5,m,"Exit.");
	};


	/**
	 * Private: Restores snapshot.
	 * TODO ANDY: Move this function up into the private section after it is proven to work well.
	 */
	var prvRestoreVM = function(vmname, snapshotname, blob, callback) {
		var m = "prvRestoreVM/" + vmname;
		tr.log(5,m,"Entry. vmname=" + vmname + " snapshotname=" + snapshotname);

		var token = getVLaunchToken(blob);

		getVMByName(vmname, token, function(err,vmObject) {
			var m = "prvRestoreVM/getVMByNameCb";
			tr.log(5,m,"Entry.");
			if (err) { return callback(err); }
			//tr.log(5,m,"vm: " + util.inspect(vmObject));

			// Extract the VM ID
			var vmid = vmObject['id'];

			// Find snapshot ID
			var snapshots = vmObject['snapshots'];
			//tr.log(5,m,"snapshots: " + util.inspect(snapshots));
			var snapshotid = "not-found";
			for (var i=0; i<snapshots.length; i++) {
				var snapshot = snapshots[i];
				if (snapshotname == snapshot['name']) {
					tr.log(5,m,"Match. snap[" + i + "]: name=" + snapshot['name'] + " id=" + snapshot['id']);
					snapshotid = snapshot['id'];
					break;
				}
				else {
					tr.log(5,m,"No match. snap[" + i + "]: name=" + snapshot['name'] + " id=" + snapshot['id']);
				}
			}
			if ("not-found" == snapshotid) {
				var msg = "ERROR: Could not find snapshot name. vmname=" + vmname + " snapshotname=" + snapshotname;
				tr.log(5,m,msg);
				return callback(msg);
			}

			// Check power
			//tr.log(5,m,"Checking power.");
			var power_state = vmObject['power_state'];
			if ("poweredOff" != power_state) {
				var msg = "ERROR: Can not restore snapshot because VM is not stopped.  vmname=" + vmname + " power_state=" + power_state;
				tr.log(5,m,msg);
				return callback(msg);
			}

			// Ensure no requests are pending for this VM
			getOpenWorkRequests(vmid, token, function(err,openRequests) {
				var m = "prvRestoreVM/getVMByNameCb/getOpenWorkRequestsCb2";
				tr.log(5,m,"Entry.");
				if (err) { return callback(err); }

				var numOpenRequests = openRequests.length;
				tr.log(5,m,"numOpenRequests=" + numOpenRequests);
				if (0 < numOpenRequests) { return callback("Sorry, this VM has another request pending."); }

				// Prepare request
				//tr.log(5,m,"Preparing request.");
				var url = vLaunchURL + "/actions/revertsnapshot";
				var payload = { "vm_id": vmid, "snapshot-id": snapshotid };
				var headers = { "Authorization": "Token token=" + token };
				var options = {
					"headers": headers,
					rejectUnauthorized: false,
					json: true
				};

				// Send request
				tr.log(5,m,"Sending request. url: " + util.inspect(url) + " payload: " + util.inspect(payload) + " options: " + util.inspect(options));
				var eyecatcher = "restore-" + vmname;
				tr.log(5,m,"Issuing request to vLaunch: " + eyecatcher);
				needle.post(url, payload, options, function(err, resp, body) {
					var m = "prvRestoreVM/getVMByNameCb/getOpenWorkRequestsCb2/needlePostCb";
					tr.log(5,m,"Entry. vmname=" + vmname + " snapshotname=" + snapshotname);
					/*
					console.log("----err---");
					console.log(err);
					console.log("----resp---");
					console.log(resp);
					console.log("----body---");
					console.log(body);
					*/
					if (err) { return callback(err); }

					var statusCode = resp['statusCode'];
					tr.log(5,m,"vmname=" + vmname + " snapshotname=" + snapshotname + " statusCode=" + statusCode);
					if (POST_SUCCESS != statusCode) { return callback("ERROR: statusCode=" + statusCode); }

					var workRequestID = body['id'];
					tr.log(5,m,"vmname=" + vmname + " snapshotname=" + snapshotname + " workRequestID=" + workRequestID);

					// Wait for completion.
					var timeStop = new Date().getTime() + TIMEOUT_RESTORE_MS;
					waitWorkRequestStatus(workRequestID, "Completed", token, eyecatcher, timeStop, "true", callback);
				});
			});
		});
		tr.log(5,m,"Exit.");
	};


	/**
	 * API: Starts the specified VM.
	 */
	this.startVM = function(vmname, snapshotname, blob, callback) {
		var m = "startVM/" + vmname;
		tr.log(5,m,"Entry. vmname=" + vmname);

		var token = getVLaunchToken(blob);

		var syncBlock = getSyncBlock(vmname);

		tr.log(5,m,"Trying sync block. vmname=" + vmname + " syncBlock=" + syncBlock.getName());
		syncBlock.enter(function() {
			tr.log(5,m,"Entered sync block: " + syncBlock.getName());
			setPower(vmname, "on", token, TIMEOUT_POWER_ON_MS, function(err,responseObject) {
				var m = "startVM/setPowerCb";

				tr.log(5,m,"Entry. Leaving sync block: " + syncBlock.getName());
				syncBlock.exit();

				if (responseObject) {
					tr.log(5,m,"Exit. Returning responseObject.");
					return callback(err,responseObject);
				}
				tr.log(5,m,"Exit. Returning err.");
				return callback(err);
			});
		});

		tr.log(5,m,"Exit.");
	};


	/**
	 * API: Stops the specified VM.
	 */
	this.stopVM = function(vmname, blob, callback) {
		var m = "stopVM/" + vmname;
		tr.log(5,m,"Entry. vmname=" + vmname);

		var token = getVLaunchToken(blob);

		var syncBlock = getSyncBlock(vmname);

		tr.log(5,m,"Trying sync block. vmname=" + vmname + " syncBlock=" + syncBlock.getName());
		syncBlock.enter(function() {
			tr.log(5,m,"Entered sync block: " + syncBlock.getName());
			setPowerOffForce(vmname, "off", token, TIMEOUT_POWER_OFF_MS, function(err,responseObject) {
				var m = "stopVM/setPowerOffForceCb";

				tr.log(5,m,"Entry. Leaving sync block: " + syncBlock.getName());
				syncBlock.exit();

				if (responseObject) {
					tr.log(5,m,"Exit. Returning responseObject.");
					return callback(err,responseObject);
				}
				tr.log(5,m,"Exit. Returning err.");
				return callback(err);
			});
		});

		tr.log(5,m,"Exit.");
	};


	/**
	 * API: Gets the IP address of the specified VM.
	 */
	this.getIP = function(vmname, blob, callback) {
		var m = "getIP/" + vmname;
		tr.log(5,m,"Entry. vmname=" + vmname);

		// All vLaunch VMs are presently at one domain
		// and all VMs have the same name in vLaunch as IPTOOLS.
		// So append the domain and be done...
		//var domain = ".rtp.raleigh.ibm.com";
		var fullyQualifiedName = vmname + "." + domain;

		// DNS Lookup
		dns.lookup(fullyQualifiedName, function(err, address, family) {
			var m = "getIP/dnsLookupCb";
			if (err) {
				var msg = "Did not find IP for VM " + fullyQualifiedName;
				tr.log(5,m,msg);
				return callback(null,{"rc": 0, "ip": "", "msg": msg });
			}
			else {
				var msg = "Returning IP for VM " + fullyQualifiedName + " ip=" + address;
				tr.log(5,m,msg);
				return callback(null,{"rc": 0, "ip": address, "msg": msg });
			}
		});
	};


	/**
	 * API: Takes snapshot.
	 */
	this.takeSnapshot = function(vmname, snapshotname, blob, callback) {
		var m = "takeSnapshot";
		tr.log(5,m,"Entry. vmname=" + vmname + " snapshotname=" + snapshotname);

		return callback("SORRY vlaunch." + m + " is not implemented yet.");
	};


	/**
	 * API: Renames snapshot.
	 */
	this.renameSnapshot = function(vmname, srcsnapshotname, dstsnapshotname, blob, callback) {
		var m = "renameSnapshot";
		tr.log(5,m,"Entry. vmname=" + vmname + " srcsnapshotname=" + srcsnapshotname + " dstsnapshotname=" + dstsnapshotname);

		return callback("SORRY vlaunch." + m + " is not implemented yet.");
	};
};

module.exports = VLaunchHypervisor;

