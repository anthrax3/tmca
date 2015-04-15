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
 * Issues requests to OpenStack to authenticate, start VMs, stop VMs, etc.
 *
 * Prereq:
 * 		Browse to OpenStack Dashboard-> Manage compute-> Access & Security-> API Access-> Download OpenStack RC File->
 *			Example: dingsor-openrc.sh
 * 		Source it (with a dot).
 *			Example:   . /tmp/dingsor-openrc.sh
 *      Enter your password when prompted.
 *		Environment variables are now set.
 *
 * TODO Add takeSnapshot, renameSnapshot
 *
 * AD 2013-1104-1407
*/

var Tr = require('./../tr.js');
var UniqueString = require('./../uniquestring.js');
var	proc = require('child_process');
var fs = require('fs');
var http = require('http');
var util = require('util');


var Opstx = function() {
	var m = "main";

	/**
	 * Init: Open a log file
	 */
	var tr = new Tr("opstx.js", 5, "out.log");  // 5=verbose  3=medium  0=errors only


	/**
	 * Init: Instantiate an object to return unique strings, used for tmp file names.
	 */
	var uniqueString = new UniqueString();


	/**
 	 * Init: Assimilate environment variables.
	 */
	var errenv = function(missingVarName) {
		console.log("ERROR: Please set environment variable: " + missingVarName);
		process.exit(1);
	}
	var pe = process.env;
	if (pe.OS_AUTH_URL) { var os_auth_url = pe.OS_AUTH_URL; } else { errenv("OS_AUTH_URL"); }
	if (pe.OS_TENANT_ID) { var os_tenant_id = pe.OS_TENANT_ID; } else { errenv("OS_TENANT_ID"); }
	if (pe.OS_TENANT_NAME) { var os_tenant_name = pe.OS_TENANT_NAME; } else { errenv("OS_TENANT_NAME"); }
	if (pe.OS_USERNAME) { var os_username = pe.OS_USERNAME; } else { errenv("OS_USERNAME"); }
	if (pe.OS_PASSWORD) { var os_password = pe.OS_PASSWORD; } else { errenv("OS_PASSWORD"); }

	tr.log(5,m,"os_auth_url=" + os_auth_url);
	tr.log(5,m,"os_tenant_id=" + os_tenant_id);
	tr.log(5,m,"os_tenant_name=" + os_tenant_name);
	tr.log(5,m,"os_username=" + os_username);
	tr.log(5,m,"os_password=XXXXXXXXX"); // + os_password);


	/**
	 * Init: Split os_auth_url into hostname, port, etc.
	 */
	var tmpUrlList = os_auth_url.split("/");
	var os_auth_path = tmpUrlList[3];
	var tmpHostPort = tmpUrlList[2].split(":");
	var os_hostname = tmpHostPort[0];
	var os_auth_port = parseInt(tmpHostPort[1], 10);

	tr.log(5,m,"os_hostname=" + os_hostname); 
	tr.log(5,m,"os_auth_port=" + os_auth_port);
	tr.log(5,m,"os_auth_path=" + os_auth_path);



	/**
	 * Private: Issues a command-line command and searches results for specified search string.
	 *
	 * Returns 
	 * 		callback(err, responseObject)
	 * 			where responseObject = { rc: 0, <responseKey>: true|false, msg: "message" } 
	 */
/* TODO: Deprecate if never used.
	var prvSearchCommand = function(cmd, search, responseKey, callback) {
		var m = "prvSearchCommand";
		tr.log(5,m,"Entry. VM cmd=" + cmd + " search=" + search + " responseKey=" + responseKey);

		var filename = "tmp/search." + responseKey + "." + search + ".tmp";
		cmd = cmd + " > " + filename;
		tr.log(5,m,"Running: " + cmd);

		// Execute command.
		proc.exec(cmd, function (err, stdout, stderr) {
			var m = 'prvSearchCommandCallback';
			tr.log(5,m,"Entry. err: ", err);
			tr.log(5,m,"stdout:\n",stdout);
			tr.log(5,m,"stderr:\n",stderr);
			if (err) {
				return callback("ERROR issuing command: " + cmd);
			}

			var fileContents = fs.readFileSync( filename, 'utf8');
			tr.log(5,m,"fileContents: >>>" + fileContents + "<<<");

			// Note: Search with spaces to handle strings which are a subset of another.
			var found = (-1 < fileContents.indexOf(" " + search + " "));

			var msg = "found=" + found;
			tr.log(5,m,"Exit. Returning " + responseKey + "=" + found);
			var rspObj = {"rc": 0, "msg": msg };
			rspObj[responseKey] = found;
			return callback(null,rspObj);
		});

		tr.log(5,m,"Exit.");
	}
*/

	/**
	 * API: Returns the state of the VM.
	 * 	callback(err, responseObject)
	 * 		where responseObject = { rc: 0, state: NON_EXISTENT|ACTIVE|PAUSED|UNRECOGNIZED, msg: "message" } 
	 *			note boolean in responseObject
	 *
	 * Uses the command-line command:
	 *		nova list
	 * 			Pipes the results to a file, then searches the file.
	 */
	this.getVMState = function(vmname, callback) {
		var detailed = "false";
		prvGetDetailedVMState(vmname, detailed, callback);
	};


	/**
	 * API: Returns the full detailed state of the VM.
	 * 	callback(err, responseObject)
	 * 		where responseObject = { rc: 0, state: NON_EXISTENT|ACTIVE|PAUSED|BUILD|ERROR|UNRECOGNIZED, msg: "message" } 
	 *			note boolean in responseObject
	 *
	 * Uses the command-line command:
	 *		nova list
	 * 			Pipes the results to a file, then searches the file.
	 */
	this.getDetailedVMState = function(vmname, callback) {
		var detailed = "true";
		prvGetDetailedVMState(vmname, detailed, callback);
	};


	/**
	 * Private: Returns the state of the VM.
	 *
	 * If detailed, returns:
	 * 	callback(err, responseObject)
	 * 		where responseObject = { rc: 0, state: NON_EXISTENT|ACTIVE|PAUSED|UNRECOGNIZED, msg: "message" } 
	 * 	else returns: 
	 * 		where responseObject = { rc: 0, state: NON_EXISTENT|ACTIVE|PAUSED|BUILD|ERROR|UNRECOGNIZED, msg: "message" } 
	 *			note boolean in responseObject
	 *
	 * Uses the command-line command:
	 *		nova list
	 * 			Pipes the results to a file, then searches the file.
	 */
	var prvGetDetailedVMState = function(vmname, detailed, callback) {
		var m = "prvGetDetailedVMState";
		tr.log(5,m,"Entry. vmname=" + vmname + " detailed=" + detailed);

		var filename = "tmp/get.vm.state." + vmname + "." + uniqueString.getUniqueString();
		cmd = "nova list > " + filename;
		tr.log(5,m,"Running: " + cmd);

		// Execute command.
		proc.exec(cmd, function (err, stdout, stderr) {
			var m = 'getVMStateCallback';
			tr.log(5,m,"Entry. vmname=" + vmname + " err: ", err);
			tr.log(5,m,"vmname=" + vmname + " stdout:\n",stdout);
			tr.log(5,m,"vmname=" + vmname + " stderr:\n",stderr);
			if (err) {
				tr.log(5,m,"Received error. Calling cb.");
				return callback("ERROR issuing command: " + cmd);
			}

			// read
			var line;
			var fileContentsString = fs.readFileSync( filename, 'utf8');
			tr.log(5,m,"vmname=" + vmname + " fileContentsString: >>>" + fileContentsString + "<<<");

			// Delete the tmp file.
			fs.unlinkSync(filename);

			var fileContentsList = fileContentsString.split("\n");
			tr.log(5,m,"vmname=" + vmname + " fileContentsList.length=" + fileContentsList.length);
			for (var i=0; i<fileContentsList.length; i++) {
				line = fileContentsList[i];
				console.log("line: " + line);

				// search for VM
				if (-1 < line.indexOf(" " + vmname + " ")) {
					tr.log(5,m,"Found VM " + vmname);
					break;
				}
			}

			if (!line) {
				var msg = "VM " + vmname + " does not exist. Returning state NON_EXISTENT.";
				tr.log(5,m,msg);
				return callback(null,{"rc": 0, "state": "NON_EXISTENT", "msg": msg });
			}
			else {
				if (-1 < line.indexOf("ACTIVE")) {
					var msg = "VM " + vmname + " state is ACTIVE.";
					tr.log(5,m,msg);
					return callback(null,{"rc": 0, "state": "ACTIVE", "msg": msg });
				}
				else if (-1 < line.indexOf("PAUSED")) {
					var msg = "VM " + vmname + " state is PAUSED.";
					tr.log(5,m,msg);
					return callback(null,{"rc": 0, "state": "PAUSED", "msg": msg });
				}
				else if ("true" == detailed && -1 < line.indexOf("BUILD")) {
					var msg = "VM " + vmname + " state is BUILD.";
					tr.log(5,m,msg);
					return callback(null,{"rc": 0, "state": "BUILD", "msg": msg });
				}
				else if ("true" == detailed && -1 < line.indexOf("ERROR")) {
					var msg = "VM " + vmname + " state is ERROR.";
					tr.log(5,m,msg);
					return callback(null,{"rc": 0, "state": "ERROR", "msg": msg });
				}
				else {
					var msg = "VM " + vmname + " state is UNRECOGNIZED.";
					tr.log(5,m,msg);
					return callback(null,{"rc": 0, "state": "UNRECOGNIZED", "msg": msg });
				}
			}
		});

		tr.log(5,m,"Exit. vmname=" + vmname);
	};


	/**
	 * API: Indicates whether the VM exists.
	 * 	callback(err, responseObject)
	 * 		where responseObject = { rc: 0, exists: true, msg: "message" } 
	 *			note boolean in responseObject
	 */
	this.exists = function(vmname, callback) {
		var m = "exists";
		tr.log(5,m,"Entry. VM name=" + vmname);

		this.getVMState(vmname, function(err, rspObj) {
			m = "existsCallback";
			tr.log(5,m,"Entry. err: ", err);
			if (err) return callback(err);
			if (0 != rspObj.rc) return callback(null,rspObj);
			var exists = ("NON_EXISTENT" != rspObj.state);
			var msg = "VM state is " + rspObj.state + ". Returning exists=" + exists;
			return callback(null,{ rc: 0, "exists": exists, "msg": msg });
		});
	};


	/**
	 * API: Indicates whether the VM exists and is active.
	 * 	callback(err, responseObject)
	 * 		where responseObject = { rc: 0, active: true, msg: "message" } 
	 *			note boolean running in responseObject
	 */
	this.isActive = function(vmname, callback) {
		var m = "isActive";
		tr.log(5,m,"Entry. VM name=" + vmname);

		this.getVMState(vmname, function(err, rspObj) {
			m = "isActiveCallback";
			tr.log(5,m,"Entry. err: ", err);
			if (err) return callback(err);
			if (0 != rspObj.rc) return callback(null,rspObj);
			var active = ("ACTIVE" == rspObj.state);
			var msg = "VM state is " + rspObj.state + ". Returning active=" + active;
			return callback(null,{ rc: 0, "active": active, "msg": msg });
		});
	};


	/**
	 * API: Indicates whether the VM exists and is paused.
	 * 	callback(err, responseObject)
	 * 		where responseObject = { rc: 0, paused: true, msg: "message" } 
	 *			note boolean running in responseObject
	 */
	this.isPaused = function(vmname, callback) {
		var m = "isPaused";
		tr.log(5,m,"Entry. VM name=" + vmname);

		this.getVMState(vmname, function(err, rspObj) {
			m = "isPausedCallback";
			tr.log(5,m,"Entry. err: ", err);
			if (err) return callback(err);
			if (0 != rspObj.rc) return callback(null,rspObj);
			var paused = ("PAUSED" == rspObj.state);
			var msg = "VM state is " + rspObj.state + ". Returning paused=" + paused;
			return callback(null,{ rc: 0, "paused": paused, "msg": msg });
		});
	};


	/**
	 * API: Boots the specified VM.
	 * 	callback(err, responseObject)
	 * 		where responseObject = { rc: 0,  msg: "message" } 
	 *
	 * Uses the command-line command.  For example:
	 *		nova boot --flavor 2 --image 576ec1c5-7fbc-413a-ac87-cce68b54006b  --key_name ding  barney
	 */
	this.bootVM = function(vmname, flavor, image, key_name, callback) {
		var m = "bootVM";
		tr.log(5,m,"Entry. vmname=" + vmname + " flavor=" + flavor + " image=" + image + " key_name=" + key_name);

		// Use key_name only if specified.
		var key_name_arg = "";
		if (null != key_name && 0 < key_name.length) {
			key_name_arg = " --key_name " + key_name;
			tr.log(5,m,"Specifying option --key_name=" + key_name);
		}

		var cmd = "nova boot" +
			" --flavor " + flavor + 
			" --image " + image +
			key_name_arg +
			" " + vmname;

		tr.log(5,m,'Running: ' + cmd);

		// Execute command.
		proc.exec(cmd, function (err, stdout, stderr) {
			var m = "bootVMCallback";
			tr.log(5,m,"Entry. err: ", err);
			tr.log(5,m,"stdout:\n",stdout);
			tr.log(5,m,"stderr:\n",stderr);
			if (err) {
				return callback("ERROR booting VM " + vmname + ": " + err);
			}
			var msg = "Ok. Booted VM " + vmname;
			tr.log(5,m,msg);
			return callback(null,{"rc": 0, "msg": msg });
		});

		tr.log(5,m,"Exit. vmname=" + vmname);
	};


	/**
	 * API: Deletes the specified VM.
	 * 	callback(err, responseObject)
	 * 		where responseObject = { rc: 0,  msg: "message" } 
	 *
	 * Uses the command-line command:
	 *		nova delete <vmname>
	 */
	this.deleteVM = function(vmname, callback) {
		var m = "deleteVM";
		tr.log(5,m,"Entry. vmname=" + vmname);

		var cmd = "nova delete " + vmname;
		tr.log(5,m,'Running: ' + cmd);

		// Execute command.
		proc.exec(cmd, function (err, stdout, stderr) {
			var m = "deleteVMCallback";
			tr.log(5,m,"Entry. err: ", err);
			tr.log(5,m,"stdout:\n",stdout);
			tr.log(5,m,"stderr:\n",stderr);
			if (err) {
				return callback("ERROR deleting VM " + vmname + ": " + err);
			}
			var msg = "Ok. Deleted VM " + vmname;
			tr.log(5,m,msg);
			return callback(null,{"rc": 0, "msg": msg });
		});

		tr.log(5,m,"Exit. vmname=" + vmname);
	};


	/**
	 * API: Pauses the specified VM.
	 * 	callback(err, responseObject)
	 * 		where responseObject = { rc: 0,  msg: "message" } 
	 *
	 * Uses the command-line command:
	 *		nova pause <vmname>
	 */
	this.pauseVM = function(vmname, callback) {
		var m = "pauseVM";
		tr.log(5,m,"Entry. vmname=" + vmname);

		var cmd = "nova pause " + vmname;
		tr.log(5,m,"Running: " + cmd);

		// Execute command.
		proc.exec(cmd, function (err, stdout, stderr) {
			var m = "pauseVMCallback";
			tr.log(5,m,"Entry. err: ", err);
			tr.log(5,m,"stdout:\n",stdout);
			tr.log(5,m,"stderr:\n",stderr);
			if (err) {
				return callback("ERROR pausing VM " + vmname + ": " + err);
			}
			var msg = "Ok. Paused VM " + vmname;
			tr.log(5,m,msg);
			return callback(null,{"rc": 0, "msg": msg });
		});

		tr.log(5,m,"Exit. vmname=" + vmname);
	};


	/**
	 * API: Unpauses the specified VM.
	 * 	callback(err, responseObject)
	 * 		where responseObject = { rc: 0,  msg: "message" } 
	 *
	 * Uses the command-line command:
	 *		nova unpause <vmname>
	 */
	this.unpauseVM = function(vmname, callback) {
		var m = "unpauseVM";
		tr.log(5,m,"Entry. vmname=" + vmname);

		var cmd = "nova unpause " + vmname;
		tr.log(5,m,"Running: " + cmd);

		// Execute command.
		proc.exec(cmd, function (err, stdout, stderr) {
			var m = "unpauseVMCallback";
			tr.log(5,m,"Entry. err: ", err);
			tr.log(5,m,"stdout:\n",stdout);
			tr.log(5,m,"stderr:\n",stderr);
			if (err) {
				return callback("ERROR unpausing VM " + vmname + ": " + err);
			}
			var msg = "Ok. Unpaused VM " + vmname;
			tr.log(5,m,msg);
			return callback(null,{"rc": 0, "msg": msg });
		});

		tr.log(5,m,"Exit. vmname=" + vmname);
	};
};

module.exports = Opstx;


