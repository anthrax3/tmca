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
 * This class implements the connection to a VirtualBox hypervisor.
 *
 * This class implements the faux interface for hypervisor classes, ihypervisor.js
 * 
 * The VirtualBox hypervisor must be installed on the local machine
 * and is accessed via vboxmanage commands.
 * 
 */
var Tr = require('./../tr.js');
var	proc = require('child_process');
var fs = require('fs');
var dns = require('dns');
var os = require('os');

var IHypervisor = function(blob) {

	var hypervisor = blob.hypervisor;
    var name = hypervisor.name;
	var domain = hypervisor.domain;
	var tr = new Tr(name, 5, "log.txt");

	// Define the command-line command based on the operating system of this TMCA.
	var VBOXMANAGE_CMD = (('Darwin' === os.type()) ? 'VBoxManage' : 'vboxmanage' );

	/**
	 * Helper method indicates whether a vboxmanage response has an error
	 */
	var vboxmanageError = function(err, stdout, stderr) {
	
		if (err) { return true; }
	
		if (stdout && 
			0 < stdout.length &&
			(-1 != stdout.indexOf('error') || -1 != stdout.indexOf('ERROR'))) { return true; }
	
		if (stderr && 
			0 < stderr.length &&
			(-1 != stderr.indexOf('error') || -1 != stderr.indexOf('ERROR'))) { return true; }
	
		return false;
	};

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
	 */
	this.isRunning = function(vmname, blob, callback) {
		var m = "isRunning";
		tr.log(5,m,"Entry. VM name=" + vmname);

		// Define virtualbox command.
		// Note: I had trouble parsing stdout. Ugly solution: pipe to file, then read file.
		var filename = 'tmp/running.vms.txt';
		var cmd = VBOXMANAGE_CMD + ' list runningvms > ' + filename;
		tr.log(5,m,'Running: ' + cmd);

		// Execute command.
		proc.exec(cmd, function (err, stdout, stderr) {
			var m = 'isRunningCallback';
			tr.log(5,m,"Entry. err: ", err);
			tr.log(5,m,"stdout:\n",stdout);
			tr.log(5,m,"stderr:\n",stderr);
			if (vboxmanageError(err, stdout, stderr)) {
				return callback("ERROR getting status of running VMs.");
			}

			var runningvmsString = fs.readFileSync( filename, 'utf8');
			tr.log(5,m,"runningvmsString: >>>" + runningvmsString + "<<<");

			var running = (-1 < runningvmsString.indexOf('"' + vmname + '"'));

			var msg = "Exit. Returning running=" + running;
			tr.log(5,m,msg);
			return callback(null,{ rc: 0, "active": running, "msg": msg });
		});
		tr.log(5,m,"Exit.");
	};


	/**
	 * API: Restores snapshot.
	 */
	this.restoreVM = function(vmname, snapshotname, blob, callback) {
		var m = "restoreVM";
		tr.log(5,m,"Entry. vmname=" + vmname + " snapshotname=" + snapshotname);

		// Define virtualbox command.
		var cmd = VBOXMANAGE_CMD + ' snapshot ' + vmname + ' restore ' + snapshotname;
		tr.log(5,m,'Running: ' + cmd);

		// Execute command.
		proc.exec(cmd, function (err, stdout, stderr) {
			var m = 'restoreVMCallback';
			tr.log(5,m,"Entry.");
			tr.log(5,m,"Entry. err: ", err);
			tr.log(5,m,"stdout:\n",stdout);
			tr.log(5,m,"stderr:\n",stderr);
			if (vboxmanageError(err, stdout, stderr)) {
				return callback("ERROR restoring VM. vmname=" + vmname + " snapshotname=" + snapshotname);
			}
			tr.log(5,m,"Exit.");
			return callback();
		});
		tr.log(5,m,"Exit.");
	};


	/**
	 * API: Starts the specified VM.
	 */
	this.startVM = function(vmname, snapshotname, blob, callback) {
		var m = "startVM";
		tr.log(5,m,"Entry. vmname=" + vmname);

		// Define virtualbox command.
		var cmd = VBOXMANAGE_CMD + ' startvm ' + vmname + ' --type headless';
		tr.log(5,m,'Running: ' + cmd);

		// Execute command.
		proc.exec(cmd, function (err, stdout, stderr) {
			var m = 'startVMCallback';
			tr.log(5,m,"Entry.");
			tr.log(5,m,"stdout:\n",stdout);
			tr.log(5,m,"stderr:\n",stderr);
			if (vboxmanageError(err, stdout, stderr)) {
				return callback("ERROR starting VM " + vmname);
			}
			tr.log(5,m,"Exit.");
			return callback();
		});
		tr.log(5,m,"Exit.");
	};

	/**
	 * API: Stops the specified VM.
	 */
	this.stopVM = function(vmname, blob, callback) {
		var m = "stopVM";
		tr.log(5,m,"Entry. vmname=" + vmname);

		// Define virtualbox command.
		var cmd = VBOXMANAGE_CMD + ' controlvm ' + vmname + ' savestate';
		tr.log(5,m,'Running: ' + cmd);

		// Execute command.
		proc.exec(cmd, function (err, stdout, stderr) {
			var m = 'stopVMCallback';
			tr.log(5,m,"Entry.");
			tr.log(5,m,"stdout:\n",stdout);
			tr.log(5,m,"stderr:\n",stderr);
			if (vboxmanageError(err, stdout, stderr)) {
				return callback("ERROR stopping VM " + vmname);
			}
			tr.log(5,m,"Exit.");
			return callback();
		});
		tr.log(5,m,"Exit.");
	};

	/**
	 * API: Gets the IP address of the specified VM.
	 */
	this.getIP = function(vmname, blob, callback) {
		var m = "getIP";
		tr.log(5,m,"Entry. vmname=" + vmname);

		var fullyQualifiedName = vmname + "." + domain;

		// DNS Lookup
		dns.lookup(fullyQualifiedName, function(err, address, family) {
			var m = "getIPCallback";
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

		// Define virtualbox command.
		// FUTURE TODO: Ensure the VM is stopped before proceeding.
		var cmd = VBOXMANAGE_CMD + ' snapshot ' + vmname + ' take ' + snapshotname;
		tr.log(5,m,'Running: ' + cmd);

		// Execute command.
		proc.exec(cmd, function (err, stdout, stderr) {
			var m = 'takeSnapshotCallback';
			tr.log(5,m,"Entry.");
			tr.log(5,m,"stdout:\n",stdout);
			tr.log(5,m,"stderr:\n",stderr);
			if (vboxmanageError(err, stdout, stderr)) {
				return callback("ERROR taking snapshot. vmname=" + vmname + " snapshotname=" + snapshotname);
			}
			tr.log(5,m,"Exit.");
			return callback();
		});
		tr.log(5,m,"Exit.");
	};

	/**
	 * API: Renames snapshot.
	 */
	this.renameSnapshot = function(vmname, srcsnapshotname, dstsnapshotname, blob, callback) {
		var m = "renameSnapshot";
		tr.log(5,m,"Entry. vmname=" + vmname + " srcsnapshotname=" + srcsnapshotname + " dstsnapshotname=" + dstsnapshotname);

		// Define virtualbox command.
		// FUTURE TODO: Ensure the VM is stopped before proceeding.
		var cmd = VBOXMANAGE_CMD + ' snapshot ' + vmname + ' edit ' + srcsnapshotname + ' --name ' + dstsnapshotname;
		tr.log(5,m,'Running: ' + cmd);

		// Execute command.
		proc.exec(cmd, function (err, stdout, stderr) {
			var m = 'renameSnapshotCallback';
			tr.log(5,m,"Entry.");
			tr.log(5,m,"stdout:\n",stdout);
			tr.log(5,m,"stderr:\n",stderr);
			if (vboxmanageError(err, stdout, stderr)) {
				return callback("ERROR renaming snapshot. vmname=" + vmname + " srcsnapshotname=" + srcsnapshotname + " dstsnapshotname=" + dstsnapshotname);
			}
			tr.log(5,m,"Exit.");
			return callback();
		});
		tr.log(5,m,"Exit.");
	};
};

module.exports = IHypervisor;

