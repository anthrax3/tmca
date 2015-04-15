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
 * This class provides the connection to an VMWare vSphere hypervisor.
 *
 * This class implements the faux interface for hypervisor classes, ihypervisor.js
 *
 * Prereqs:
 *
 * - The VMWare Perl SDK tool kit must be installed on the local machine.
 *      The version of the tool kit must match the target vmware version.
 *      The perl scripts must be added to PATH.  Example:
 *          export VMWARE_APPS_HOME=/usr/lib/vmware-vcli/apps
 *          export PATH=${PATH}:${VMWARE_APPS_HOME}/vm
 *
 * - Optional for version 5.0:  define workaround for bug in toolkit:
 *       export PERL_LWP_SSL_VERIFY_HOSTNAME=0
 *
 * vmware is accessed via command-line commands:
 *		vmcontrol.pl
 *		snapshotmanager.pl
 *		guestinfo.pl
 * 
 *
 */
var Tr = require('./../tr.js');
var	proc = require('child_process');
var fs = require('fs');
var dns = require('dns');
var UniqueString = require('./../uniquestring.js');

var VMWareHypervisor = function(blob) {

	var hypervisor = blob.hypervisor;

    var name = hypervisor.name;
	var domain = hypervisor.domain;
	var url = hypervisor.url;
	var username = hypervisor.username;
	var password = process.env[ hypervisor.env_password ];

	var common_args = ' --username "' + username + '" --password ' + password + ' --url ' + url + ' ';
	var vmcontrol_cmd = 'vmcontrol.pl' + common_args;
	var snapshotmgr_cmd = 'snapshotmanager.pl' + common_args;
	var guestinfo_cmd = 'guestinfo.pl' + common_args;

	var tr = new Tr(name, 5, "log.txt");		
	tr.log(5,"ctor","name=" + name + " dom=" + domain + " common_args: " + common_args);


	/**
	 * Init: Instantiate an object to return unique strings, used for tmp file names.
	 */
	var uniqueString = new UniqueString();


	/**
	 * Helper method indicates whether a vmware response string has an error
	 */
	var vmwareError = function(err, stdout, stderr) {

		if (err) { return true; }
	
		if (stdout && 
			0 < stdout.length &&
			(-1 != stdout.indexOf('error') || 
			-1 != stdout.indexOf('ERROR'))) { return true; }
	
		if (stderr && 
			0 < stderr.length &&
			(-1 != stderr.indexOf('error') || 
			-1 != stderr.indexOf('ERROR') ||
			-1 != stderr.indexOf('No Virtual Machine Found'))) { return true; }
	
		if (stdout && 
			0 < stdout.length &&
			(-1 != stdout.indexOf('Snapshot Not Found'))) { return true; }
	
		return false;
	};

	/**
	 * Helper method indicates whether a string read from a file contains an error message
	 */
	var fileStringError = function(fileString) {

		if (null == fileString) { return true; }

		if (fileString &&
			0 < fileString.length &&
			(-1 != fileString.indexOf('No Virtual Machine Found'))) { return true; }

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
	 *
	 * Note: In lieu of an explicit query, use the guestinfo command.
	 * Running:
	 *		guestinfo.pl --operation display --vmname vads20b
	 *			Guest Info for the Virtual Machine 'vads20b' under host visesx0502.rtp.raleigh.ibm.com
	 *			(plus many lines of additional information)
	 * Stopped:
	 *		guestinfo.pl --operation display --vmname vads20b
	 *			For display, Virtual Machine 'vads20b' under host visesx0502.rtp.raleigh.ibm.com should be powered ON
	 */
	this.isRunning = function(vmname, blob, callback) {
		var m = "isRunning/" + vmname;
		tr.log(5,m,"Entry. VM name=" + vmname);

		// Define command.  Pipe results to file.
		var filename = "tmp/guestinfo." + vmname + "." + uniqueString.getUniqueString();
		var cmd = guestinfo_cmd + " --operation display --vmname " + vmname + " > " + filename;
		tr.log(5,m,'Running: ' + cmd);

		// Execute command.
		proc.exec(cmd, function (err, stdout, stderr) {
			var m = 'isRunningCallback/' + vmname;
			tr.log(5,m,"Entry. err: ", err);
			tr.log(5,m,"stdout:\n",stdout);
			tr.log(5,m,"stderr:\n",stderr);
			if (vmwareError(err, stdout, stderr)) {
				return callback("ERROR getting status of running VMs.");
			}

			var fileString = fs.readFileSync( filename, 'utf8');
			tr.log(5,m,"fileString: >>>" + fileString + "<<<");
			if (fileStringError(fileString)) {
				return callback("ERROR getting status of running VMs.");
			}

			var runningString = "Guest Info for the Virtual Machine '" + vmname + "' under host";
			var running = (-1 < fileString.indexOf(runningString));

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
		var m = "restoreVM/" + vmname;
		tr.log(5,m,"Entry. vmname=" + vmname + " snapshotname=" + snapshotname);

		// Define vmware command.
		var cmd = snapshotmgr_cmd + ' --operation goto  --vmname ' + vmname + ' --snapshotname ' + snapshotname;
		tr.log(5,m,'Running: ' + cmd);

		// Execute command.
		proc.exec(cmd, function (err, stdout, stderr) {
			var m = 'restoreVMCallback/' + vmname;
			tr.log(5,m,"Entry.");
			tr.log(5,m,"Entry. err: ", err);
			tr.log(5,m,"stdout:\n",stdout);
			tr.log(5,m,"stderr:\n",stderr);
			if (vmwareError(err, stdout, stderr)) {
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
		var m = "startVM/" + vmname;
		tr.log(5,m,"Entry. vmname=" + vmname);

		// Define command.
		var cmd = vmcontrol_cmd + ' --operation poweron  --vmname ' + vmname;
		tr.log(5,m,'Running: ' + cmd);

		// Execute command.
		proc.exec(cmd, function (err, stdout, stderr) {
			var m = 'startVMCallback/' + vmname;
			tr.log(5,m,"Entry.");
			tr.log(5,m,"stdout:\n",stdout);
			tr.log(5,m,"stderr:\n",stderr);
			if (vmwareError(err, stdout, stderr)) {
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
		var m = "stopVM/" + vmname;
		tr.log(5,m,"Entry. vmname=" + vmname);

		// Define command.
		var cmd = vmcontrol_cmd + ' --operation poweroff  --vmname ' + vmname;
		tr.log(5,m,'Running: ' + cmd);

		// Execute command.
		proc.exec(cmd, function (err, stdout, stderr) {
			var m = 'stopVMCallback/' + vmname;
			tr.log(5,m,"Entry.");
			tr.log(5,m,"stdout:\n",stdout);
			tr.log(5,m,"stderr:\n",stderr);
			if (vmwareError(err, stdout, stderr)) {
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
		var m = "getIP/" + vmname;
		tr.log(5,m,"Entry. vmname=" + vmname + " domain=" + domain);

		var fullyQualifiedName = vmname + "." + domain;

		// DNS Lookup
		dns.lookup(fullyQualifiedName, function(err, address, family) {
			var m = "getIPCallback/" + vmname;
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
		var m = "takeSnapshot/" + vmname;
		tr.log(5,m,"Entry. vmname=" + vmname + " snapshotname=" + snapshotname);

		// FUTURE TODO: Ensure the VM is stopped before proceeding.

		// Define command.
		var cmd = snapshotmgr_cmd + ' --operation create  --vmname ' + vmname + '  --snapshotname ' + snapshotname;
		tr.log(5,m,'Running: ' + cmd);

		// Execute command.
		proc.exec(cmd, function (err, stdout, stderr) {
			var m = 'takeSnapshotCallback/' + vmname;
			tr.log(5,m,"Entry.");
			tr.log(5,m,"stdout:\n",stdout);
			tr.log(5,m,"stderr:\n",stderr);
			if (vmwareError(err, stdout, stderr)) {
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
		var m = "renameSnapshot/" + vmname;
		tr.log(5,m,"Entry. vmname=" + vmname + " srcsnapshotname=" + srcsnapshotname + " dstsnapshotname=" + dstsnapshotname);

		// FUTURE TODO: Ensure the VM is stopped before proceeding.

		// Define command.
		var cmd = snapshotmgr_cmd + ' --operation rename  --vmname ' + vmname + ' --snapshotname ' + srcsnapshotname + '  --newname ' + dstsnapshotname;
		tr.log(5,m,'Running: ' + cmd);

		// Execute command.
		proc.exec(cmd, function (err, stdout, stderr) {
			var m = 'renameSnapshotCallback/' + vmname;
			tr.log(5,m,"Entry.");
			tr.log(5,m,"stdout:\n",stdout);
			tr.log(5,m,"stderr:\n",stderr);
			if (vmwareError(err, stdout, stderr)) {
				return callback("ERROR renaming snapshot. vmname=" + vmname + " srcsnapshotname=" + srcsnapshotname + " dstsnapshotname=" + dstsnapshotname);
			}
			tr.log(5,m,"Exit.");
			return callback();
		});
		tr.log(5,m,"Exit.");
	};
};

module.exports = VMWareHypervisor;

