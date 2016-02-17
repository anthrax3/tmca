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
	TMCA.js provides a service to lease real and virtual devices.

	Server configuration parameters are read from file server.json
		contextroot - the name of this application, used in request URL.
		listenport - The port on which this server will listen.

	The 'database' of devices is stored in file devices.json
	The 'database' of users is stored in file users.json
	The 'database' of hypervisors is stored in file hypervisors.json

	All REST request and response messages are in json format.
*/
var Tr = require('./tr.js');
var Snapshots = require('./snapshots.js');
var util = require('util');
var net = require('net');
var fs = require('fs');
var restify = require('restify');
var	proc = require('child_process');
var os = require('os');
var NodeMailWrapper = require('./nodemailwrapper.js');

// Instantiate an object to help us send emails when a machine is leased.
var nodeMailWrapper = new NodeMailWrapper();

// Instantiate a verbose log (see tr.js)
var LOG_FILENAME = "log.txt"
var LOG_LEVEL = 5;
var tr = new Tr("tmca.js", LOG_LEVEL, LOG_FILENAME);  // 5=verbose  3=medium  0=errors only

// Instantiate a high-level activity log in human-readable form.
var activityLog = new Tr("",5,"activity.txt");

// Instantiate a high-level activity log in machine-readable form.
var activityJson = new Tr("",5,"activity.json");

/**
 * User name of the administrator of this service.  Used to send emails.
 */
var ADMIN_USER = 'andy';

/**
 * User name which applies operating system updates and security patches.
 */
var UPDATE_USER = 'update-robot';

/**
 * User name which performs health checks.
 */
var HEALTH_USER = 'health-robot';

/**
 * User name which runs automated tests.
 */
var TEST_USER = 'test-robot';

/**
 * Name of the default master snapshot for VMs.
 */
var MASTER_SNAPSHOT_NAME = "master";

/**
 * Name of the file which contains configuration options for this node.js server.
 * Includes listen port number, context root, etc.
 */
var SERVER_CONFIG_FILENAME = 'server.json'

/**
 * Name of the file which contains information about devices to be leased.
 */
var DEVICES_FILENAME = 'devices.json'

/**
 * Name of the file which contains information about leased devices.
 */
var LEASES_FILENAME = 'leases.json'

/**
 * Name of the file which contains information about users of this app.
 */
var USERS_FILENAME = 'users.json'

/**
 * Name of the base index.html file.
 */
var INDEX_HTML_FILENAME = 'index.html'

/**
 * Local 'cache' of IP addresses and hostnames.  Useful for usage analysis and debug.
 */
var ipHostnameCache = {};

/**
 * Max number of activities to be stored in acitivtyCache per device.
 */
var MAX_ACTIVITIES = 7;

/**
 * Local 'cache' of devices and activities.  Useful for usage analysis and debug.
 */
var activityCache = {};

/**
 * Helper method logs the IP and port number of the incoming request.
 * Identifies users of this app.
 */
function logClientRequest(req) {
	var m = "logClientRequest";
	try {
		var socket = req.connection;
		var remoteAddress = socket.remoteAddress;
		var port = socket.remotePort;

		// Log the client IP and port.
		tr.log(5,m,'-------------------------------');
		tr.log(5,m,"Incoming from: " + remoteAddress + ":" + port);

		var domainList = ipHostnameCache[ remoteAddress ];
		if (domainList) {
			// Log the client hostname(s) from cache.
			for (var i=0; i<domainList.length; i++) {
				tr.log(5,m,domainList[i]);
			}
		}
		else {
			// Query the client hostname(s) and cache it.
			dns.reverse(remoteAddress, function(err, domains) {
				var m = "logClientRequestCallback";
				if (err) {
					//console.log("err");
					return;
				}

				// Save the list of hostnames for this IP for future use.
				ipHostnameCache[ remoteAddress ] = domains;

				// Show it.
				for (var i=0; i<domains.length; i++) {
					tr.log(5,m,remoteAddress + " " + domains[i]);
				}
			});
		}
	}
	catch (e) { ; }
}

/**
 * Records activity for analysis and debug to a human-readable log file.
 * Example:  recordActivityLog( "wltestu0", "[2013-0331] leased by francois/9.24.35.42");
 */
function recordActivityLog(devicename, activity) {
	var m = 'recordActivityLog';
	tr.log(5,m,'Entry. devicename=' + devicename + ' activity=' + activity);
	activityLog.log(5,devicename,activity + "<br>");
	activity = '[' + tr.getLogTimestamp() + '] ' + activity;
	tr.log(5,m,'Prepended timestamp. activity=' + activity);
	var activityList = activityCache[ devicename ];
	if (activityList) {
		activityList.push(activity);
		if (MAX_ACTIVITIES < activityList.length) {
			activityList.splice(0,1);
		}
	}
	else {
		activityCache[ devicename ] = [ activity ];
	}
}

/**
 * Records activity for analysis and debug to a JSON file.
 * Example:  { "lessee":"johndoe", "action":"leased", "devicename":"oradb11c" }
 */
function recordActivityJson(lessor, devicename, action, lessorAddress) {
	var m = 'recordActivityJson';
	//tr.log(5,m,'Entry. lessor=' + lessor + ' devicename=' + devicename + ' action=' + action + ' lessorAddress=' + lessorAddress);

	var activity = {
		"lessee": lessor,
		"lesseeAddress": lessorAddress,
		"devicename": devicename,
		"action": action
		};

	tr.log(5,m,"Recording activity in json file: " + util.inspect(activity));
	activityJson.json(activity);
}

/**
 * Records the specified action in the activity cache.
 * Example: recordActivityHelper(  req, "francois", "wltestu0", "leased");
 */
function recordActivityHelper(req, lessor, devicename, action) {
	var m = 'recordActivityHelper';
	tr.log(5,m,'lessor=' + lessor + ' devicename=' + devicename + ' action=' + action);
	var lessorSocket = req.connection;
	var lessorAddress = lessorSocket.remoteAddress;
	var activity = action + ' by ' + lessor + '/' + lessorAddress;
	recordActivityLog(devicename, activity);
	recordActivityJson(lessor, devicename, action, lessorAddress);
}

/**
 * Returns the list of activities for a device.
 */
function getActivityList(devicename) {
	var activityList = activityCache[ devicename ];
	if (!activityList) return []
	return activityList;
}

/**
 * Returns HTML with a list of users.
 * This is intended to be inserted in a <select> object.
 */
function getUsersHTML() {
	var rc = '<option></option>';
	for (var i=0; i<users.length; i++) {
		var user = users[i];
		rc = rc + '<option>' + user.name + '</option>';
	}
	console.log("Returning rc: " + rc);
	return rc;
}

/**
 * Returns HTML which dispalys the current timestamp at the server geo location.
 * Example:
 * <iframe src="http://free.timeanddate.com/clock/i3kd5lxl/n207/tlse27/tt0/tw0/tm3/td2/th1/ta1/tb3" frameborder="0" width="173" height="18"></iframe>
 * Note: at http://www.timeanddate.com, the personal clock for Sweden/Swedish shows year-month-date-hour-min-sec.

 */
function getServerTimeHTML() {
	var servertime = serverconfig.servertime;
	if (!servertime) return "undefined";

	return '<iframe src="' + servertime['url'] + '"' +
		' frameborder="' + servertime['frameborder'] + '"' +
		' width="' + servertime['width'] + '"' +
		' height="' + servertime['height'] + '"></iframe>';
}

/**
 * Returns the contents of file index.html to a web browser.
 * The code in index.html is intended to allow humans to administer this app.
 *
 * Request:  curl "http://localhost:7890/pool/"
 */
function getHTML(req, res) {
	var m = "getHTML";
	logClientRequest(req);
	tr.log(5,m,"Entry. Returning contents of file index.html");

	fs.readFile(__dirname + '/index.html', 'UTF8', function (err, data) {
		if (err) {
			console.log("Bozo. Caught error. err=" + err);
			return;
		}
		//Insert the contextroot and version into the HTML before delivery to the browser.
		data = data.replace("$$$CONTEXT_ROOT$\$$", contextroot);
		data = data.replace("$$$VERSION$$$", thisFileMtime);
		data = data.replace("$$$USERS$$$", getUsersHTML());
		data = data.replace("$$$TIME_URL$$$", getServerTimeHTML());
		data = data.replace("$$$TITLE$$$", "TMCA on " + os.hostname());
		data = data.replace("$$$HOSTNAME$$$", os.hostname());

		res.setHeader('Content-Type', 'text/html');
		res.writeHead(200);
		res.end(data);
	});
}


/**
 * Returns contents of activity log to web browser.
 * Intended for usage analysis.
 *
 * Request:  curl "http://localhost:7890/pool/log/12345"
 *  where 12345 is the number of characters to be returned.
 */
function getLog(req, res) {
	var m = "getLog";
	logClientRequest(req);
	tr.log(5,m,"Entry. Returning contents of log file.");

	var numchars = req.params.numchars;

	if (fs.existsSync('./activity.txt')) {
		fs.readFile(__dirname + '/activity.txt', 'UTF8', function (err, data) {
			if (err) {
				console.log("Bozo. Caught error. err=" + err);
				return;
			}

			res.setHeader('Content-Type', 'text/html');
			res.writeHead(200);

			if (0 == numchars || data.length < numchars) {
				res.end(data);
			}
			else {
				// Send the last n characters, not the entire history of the world.
				var startIndex = data.length - numchars;
				var lessData = data.substring(startIndex, data.length);
				var lessData = "Presenting the last " + numchars + " characters of activity.txt...<br><br>" + lessData;
				tr.log(5,m,"data.length=" + data.length + " numchars = " + numchars + " startIndex=" + startIndex + " len(lessData)=" + lessData.length);
				res.end(lessData);
			}
		});
	}
	else {
		res.setHeader('Content-Type', 'text/html');
		res.writeHead(200);
		res.end('Sorry, log data is not available.');
	}
}

/**
 * Returns a new javascript object identical to the supplied device.
 * Merges the supplied lease object if provided.
 */
function cloneDevice(device, lease) {
	var m = "cloneDevice";
	//tr.log(5,m,"Entry.");
	var rcDevice = {};

	for (var key in device) {
		if (device.hasOwnProperty(key)) {
			rcDevice[key] = device[key];
		}
	}

	if (lease) {
		rcDevice['available'] = lease.available;
		rcDevice['lessor'] = lease.lessor;
	}
	//tr.log(5,m,"Exit. Returning device: " + util.inspect(rcDevice));
	//tr.log(5,m,"Exit. Returning device.");
	return rcDevice;
}

 
/**
 * Helper returns an clone of the devices object with 
 * some fields blanked out and some fields added.
 */
function getDevicesFiltered(lessor) {
	var m = "getDevicesFiltered";
	tr.log(5,m,"Entry. lessor=" + lessor);

	var rcDeviceList = [];
	for (var i=0; i<devices.length; i++) {
		var device = devices[i];
		var lease = getLeaseByName(device.name);
		/*
		tr.log(5,m,"Considering i=" + i + 
			" name=" + device.name +
			" os=" + device.os + 
			" available=" + lease.available);
		*/
		var rcDevice = cloneDevice(device, lease);

		// Filter it.
		if (lessor != lease['lessor']) {
			rcDevice['hostname'] = '.';
			rcDevice['username'] = '.';
			rcDevice['password'] = '.';
			rcDevice['adminname'] = '.';
			rcDevice['adminpswd'] = '.';
			rcDevice['remote_access_comments'] = '.';

			// Enable/disable the lease button for windows and MSDN license.
			if ("windows" == device['os']) {
				if (!userHasMSDN(lessor)) {
					tr.log(5,m,"no msdn for windows.");
					rcDevice['available'] = 'no_msdn';
				}
			}
		}

		rcDevice['snapshot'] = snapshots.getSnapshotName(device.name);

		rcDeviceList.push(rcDevice);
	}
	//tr.log(5,m,"Exit. rcDeviceList: " + JSON.stringify(rcDeviceList));
	tr.log(5,m,"Exit. Returning rcDeviceList.");
	return rcDeviceList;
}

/**
 * Returns all information about all devices.  
 *
 * Example:
 * Request:  curl "http://localhost:7890/pool/getAllDevices/lessorname"
 * Response:  [{ "name": "dingHTC", 
 *               "os": "android2.3", 
 *               "hostname": "dingp.raleigh.ibm.com", 
 *               "available": "true", 
 *               "lessor": "n/a" }, 
 *             { "name": "ralvm13", 
 *               "os": "ubuntu12.04", 
 *               "hostname": "ralvm13.rtp.raleigh.ibm.com", 
 *               "available": "true", 
 *               "lessor": "n/a" }]
 */
function getAllDevices(req, res) {
	var m = "getAllDevices";
	logClientRequest(req);
	tr.log(5,m,"Entry/Exit: Returning all devices");
	tr.log(9,m,"devices: " + JSON.stringify(devices));

	// Extract the lessor name from the request.
	var lessor = req.params.lessor
	tr.log(5,m,"lessor=" + lessor);

	var filteredDevices = getDevicesFiltered(lessor);

	res.send(filteredDevices);
}

/**
 * Lists devices which match the specified:
 *		Contents (example: tomcat7, websphere8), 
 *		OS (example: linux, windows), and 
 *		architecture bits (ie, 32 or 64).
 * and for which the user has auth to lease (eg, has windows MSDN)
 *
 * If found, returns all characteristics about the device(s).
 * Otherwise, returns an empty list.
 *
 * Note: bits may be an empty string "" or zero "0".  These serve as wildcards.
 *
 * Example:
 * Request: curl "http://tmca0.rtp.raleigh.ibm.com:7890/pool/getDevicesByContentsOSBits/tomcat/linux/64/bozo"
 * Response:  [{ "name": "dingHTC", 
 *               "os": "android2.3", 
 *               "hostname": "dingp.raleigh.ibm.com", 
 *               "available": "false", 
 *               "lessor": "fred" }]
 */
function getDevicesByContentsOSBits(req, res) {
	var m = "getDevicesByContentsOSBits";
	logClientRequest(req);
	tr.log(5,m,"Entry.");	
	var rcDeviceList = [];

	// Extract the desired operating system and lessor name from the request.
	var desiredContents = req.params.contents;
	var desiredOS = req.params.os;
	var desiredBits = req.params.bits;
	var lessor = req.params.lessor

	tr.log(5,m,"desiredContents=" + desiredContents + " desiredOS=" + desiredOS + " desiredBits=" + desiredBits + " lessor=" + lessor);

	// Search for devices.
	found = false;
	for (var i=0; i<devices.length; i++) {
		var device = devices[i];
		var lease = getLeaseByName(device.name);
		/*
		tr.log(5,m,"Considering i=" + i + 
			" name=" + device.name + 
			" contents=" + device.contents + 
			" os=" + device.os + 
			" bits=" + device.bits + 
			" available=" + lease.available);
		*/
		if (matchContentsOsBits(device, desiredContents, desiredOS, desiredBits) &&
			(("windows" == device['os'] && userHasMSDN(lessor)) || ("windows" != device['os']))) {
			tr.log(5,m,"match. i=" + i + 
				" name=" + device.name + 
				" contents=" + device.contents + 
				" os=" + device.os + 
				" bits=" + device.bits + 
				" available=" + lease.available);
			found = true;

			var rcDevice = cloneDevice(device, lease);
			rcDevice['hostname'] = '.';
			rcDevice['username'] = '.';
			rcDevice['password'] = '.';
			rcDevice['adminname'] = '.';
			rcDevice['adminpswd'] = '.';

			rcDeviceList.push(rcDevice);
		}
		//else {
		//	tr.log(5,m,"no match.");
		//}
	}

	// TODO: Standardize this response object.
	tr.log(5,m,"Exit. Returning list: " + JSON.stringify(rcDeviceList));
	res.send(rcDeviceList);
}

/**
 * Indicates whether the hypervisor supports user-settable snapshot names.
 */
/*
function settableSnapshots(hypervisor) {
	var m = "settableSnapshots";
	tr.log(5,m,"Entry. ");
	tr.log(5,m,"hypervisor=" + util.inspect(hypervisor));
	tr.log(5,m,"hypervisor.name=" + hypervisor.name);
	if (hypervisor.hasOwnProperty("settable_snapshots")) {
		tr.log(5,m,"has own property.");		
		tr.log(5,m,"returning " + hypervisor.settable_snapshots);
		return hypervisor.settable_snapshots;
	}
	tr.log(5,m,"hypervisor does not have property settable_snapshots. Returning false.");		
	return false;
}
*/

/**
 * Helper indicates whether the machine is a VM, leased, and leased by lessor.
 * Returns "ready" if machine is ready.  Returns nothing if not ready.
 */
function readyForHypervisor(name, lessor) {
	var m = "readyForHypervisor";
	tr.log(5,m,"Entry. name=" + name + " lessor=" + lessor);

	// Verify the device is a VM
	if (!isVirtualMachine(name)) {
		tr.log(5,m,"ERROR. Device is not a virtual machine. name=" + name);
		return;
	}

	// Verify the device is not available.
	if (isAvailable(name)) {
		tr.log(5,m,"ERROR. Device is not leased. name=" + name);
		return;
	}
	
	// Verify the user leases the device.
	if (!userLeasesDevice(name,lessor)) {
		tr.log(5,m,"ERROR. User is not lessee. name=" + name);
		return;
	}
	
	tr.log(5,m,"Exit. Device " + name + " is ready for hypervisor");
	return "ready";
}


/**
 * Returns a device object by name. Returns an empty object if not found.
 */
function getNonEmptyDeviceByName(name) {
	var device = getDeviceByName(name);
	if (null == device) {
		device = {};
	}
	return device;
}


/**
 * Returns a device object by name. Returns null if not found.
 */
function getDeviceByName(name) {
	var m = "getDeviceByName";
	tr.log(5,m,"Entry. name=" + name + " devices.length=" + devices.length);
	for (var i=0; i<devices.length; i++) {
		var device = devices[i];
		//tr.log(5,m,"device[" + i + "]=" + device.name);
		if (name == device.name) {
			tr.log(5,m,"Exit. Returning found device " + name);
			return device;
		}
	}
	tr.log(5,m,"Exit. Device " + name + " not found. Returning null.");
	return;
}


/**
 * Returns an object with various and sundry information which 
 * may be required by a hypervisor.
 */
function getBlob(deviceName, lessor) {
	var m = "getBlob";

	var blob = {};
	if (null != lessor) {
		var user = getUser(lessor);
		blob['user'] = user;
	}
	blob['users'] = users;
	var device = getNonEmptyDeviceByName(deviceName);
	blob['device'] = device;
	if (device.hasOwnProperty("owner")) {
		var deviceowner = getUser(device['owner']);
		blob['deviceowner'] = deviceowner;
	}
	tr.log(5,m,"Exit. deviceName=" + deviceName + " lessor=" + lessor + " Returning blob.");
	//console.log(blob);
	return blob;
}


/**
 * Returns a lease object by name. 
 * Note:  If not found, creates a new element in the table.
 */
function getLeaseByName(name) {
	var m = "getLeaseByName";
	//tr.log(5,m,"Entry. name=" + name + " leases.length=" + leases.length);

	for (var i=0; i<leases.length; i++) {
		var lease = leases[i];
		//tr.log(5,m,"lease[" + i + "]=" + lease.name);
		if (name == lease.name) {
			//tr.log(5,m,"Exit. Returning found lease: name=" + name + " available=" + lease.available);
			return lease;
		}
	}

	// Not found. Create new lease.
	tr.log(5,m,"Lease " + name + " not found. Creating new entry.");
	lease = {"name": name, "available": "true", "lessor": "n/a", "leasetimestamp": "n/a", "emailtimestamp": "n/a"};
	leases.push(lease);

	// Save to file.
	fs.writeFileSync(LEASES_FILENAME, JSON.stringify(leases));

	tr.log(5,m,"Exit. Returning new lease: " + util.inspect(lease));
	return lease;
}


/**
 * Removes the specified lease from the list.
 */
function removeLeaseByName(name) {
	var m = "removeLeaseByName";

	// Search for the specific device.
	for (var i=0; i<leases.length; i++) {
		var lease = leases[i];
		if (name == lease.name) {
			tr.log(5,m,"match.");
			// Delete the lease from the list
			leases.splice(i,1);
			// Save to file.
			fs.writeFileSync(LEASES_FILENAME, JSON.stringify(leases));
			break;
        }
	}
}


/**
 * Marks a device as leased.
 */
function markLeased(name, lessor) {
	var m = "markLeased";
	tr.log(5,m,"Entry. name=" + name + " lessor=" + lessor);

	var timeNow = (new Date()).getTime();

	var lease = getLeaseByName(name);
	lease.available = "false";
	lease.lessor = lessor;
	lease.leasetimestamp = timeNow;
	lease.emailtimestamp = "n/a";

	// Save to file.
	fs.writeFileSync(LEASES_FILENAME, JSON.stringify(leases));
}


/**
 * Marks a device as unleased.
 */
function markUnleased(name) {
	var m = "markUnleased";
	tr.log(5,m,"Entry. name=" + name);

	var lease = getLeaseByName(name);
	lease.available = "true";
	lease.lessor = "n/a";
	lease.leasetimestamp = "n/a";
	lease.emailtimestamp = "n/a";

	// Save to file.
	fs.writeFileSync(LEASES_FILENAME, JSON.stringify(leases));
}


/**
 * Helper function returns the snapshot name for a device from devices.json.
 */
/* 2015-0129-1200 Deprecated by moving the snapshot information into snapshots.js
function getSnapshotName(devicename) {
	var m = "getSnapshotName";
	tr.log(5,m,"Entry. devicename=" + devicename);

	var device = getDeviceByName(devicename);
	//tr.log(5,m,"device: " + util.inspect(device));

	if (device && 'snapshot' in device) {
		var snap = device.snapshot;
		tr.log(5,m,"Returning snapshotname " + snap + " for device " + devicename);
		return snap;
	}
	else {
		tr.log(5,n,"Returning default snapshot name " + MASTER_SNAPSHOT_NAME + " for device " + devicename); 
		return MASTER_SNAPSHOT_NAME;
	}
}
*/

/**
 * Helper function returns a hypervisor module for the specified VM.
 */
function getHypervisor(devicename) {
	var m = "getHypervisor";
	tr.log(5,m,"Entry. devicename=>>>" + devicename + "<<<");
	var hypervisor = findHypervisorForDevice(devicename);
	if (undefined != hypervisor && null != hypervisor) {
		tr.log(5,m,"Exit. Returning found hypervisor object. " + util.inspect(hypervisor.object));
		return hypervisor.object;
	}
	tr.log(5,m,"Exit. Did not find hypervisor object.");
}

function findHypervisorForDevice(devicename) {
	var m = "findHypervisorForDevice";
	tr.log(5,m,"Entry. devicename=>>>" + devicename + "<<<");

	var device = getDeviceByName(devicename);
	if (!device) {
		tr.log(5,m,"ERROR: Could not find device " + devicename);
		return;
	}
	//tr.log(5,m,"Found device object: " + util.inspect(device));

	var deviceHypervisor = device.hypervisor;
	if (!deviceHypervisor) {
		tr.log(5,m,"ERROR: Did not find device " + devicename);
		//tr.log(5,m,"device: " + util.inspect(device));
		return;
	}

	tr.log(5,m,"Searching for hypervisor " + deviceHypervisor + " hypervisors.length=" + hypervisors.length);
	for (var i=0; i<hypervisors.length; i++) {
		var hypervisor = hypervisors[i];
		////tr.log(5,m,"Considering hypervisor[" + i + "]: >>>" + hypervisor.name + "<<< vs deviceHypervisor >>>" + deviceHypervisor + "<<< " + util.inspect(hypervisor));
		if (deviceHypervisor == hypervisor.name) {
			tr.log(5,m,"Exit. Returning hypervisor " + hypervisor.name + " with object " + hypervisor.object);
			return hypervisor;
		}
	}
	tr.log(5,m,"ERROR. Did not find hypervisor for device " + devicename);
};


/**
 * Returns VM status: running or stopped. 
 *
 * Example:
 * Request:  curl "http://localhost:7890/pool/getVMStatus/dingHTC"
 * Response:  [{ "vmstatus": "running" }]   or stopped
 */
function getVMStatus(req, res) {
	var m = "getVMStatus";
	logClientRequest(req);
	tr.log(5,m,"Entry: Getting VM status.");

	// Extract the device name from the request.
	var name = req.params.name
	tr.log(5,m,"name=" + name);
	//tr.log(5,m,"params: " + JSON.stringify(req.params));
	var rc = { 'name': name };

	// Get the hypervisor for the VM
	var hypervisor = getHypervisor(name);
	tr.log(5,m,"hypervisor=" + hypervisor);
	if (!hypervisor) {
		return sendErrorResponse(res,rc,m,"ERROR. Could not find hypervisor for VM: " + name);
	}

	// Get miscellaneous information which may be required by the hypervisor.
	var blob = getBlob(name, null);

	// Execute command
	tr.log(5,m,"Calling hypervisor.isRunning(" + name + ")");
	tr.log(5,m,"getName: " + hypervisor.getName());
	hypervisor.isRunning(name, blob, function(err, running) {
		var m = "getVMStatusCallback";
		if (err) {
			tr.log(5,m,err);
			sendErrorResponse(res,rc,m,"ERROR getting VM status. " + name);
		}
		else {
			// Object value.
			if ('rc' in running) {
				tr.log(5,m,"Handling response object: " + util.inspect(running));
				if (0 != running.rc) {
					return sendErrorResponse(res,rc,m,"ERROR getting VM status. " + name);
				}
				if ('running' in running) {
					running = running.running;
				}
				else if ('active' in running) {
					running = running.active;
				}
				else {
					tr.log(5,m,"WARNING: Unrecognized object.");
				}
			}

			// String value.
			var vmstatus = ((running) ? 'running' : 'stopped');

			var activityList = getActivityList(name);
			var lastActivity = ((0 < activityList.length) ? activityList[ activityList.length-1 ] : '' );

			rc['running'] = running;
			rc['vmstatus'] = vmstatus;
			rc['activity'] = lastActivity;
			sendSuccessResponse(res,rc,m,"Got status for VM " + name);
		}
		tr.log(5,m,"Exit.");
	});

	tr.log(5,m,'Exit');
}


/**
 * Returns the email address for a user.  Returns undefined if not found.
 */
function getUserEmail(username) {
	for (var i=0; i<users.length; i++) {
		var user = users[i];
		if (username == user.name) {
			if (user.email) {
				if (2 < user.email.length) {
					var email = user.email;
				}
			}
			break;
		}
	}	
	return email;
}

/**
 * Sends an email to the specified users.
 */
function sendEmail(usernameList, subject, message) {
	var m = 'sendEmail';
	//tr.log(5,m,'Entry. subject: ' + subject + ' message: ' + message);

	// Get the emails for each user.
	var emailList = [];
	for (var i=0; i<usernameList.length; i++) {
		var username = usernameList[i];
		var email = getUserEmail(username);
		if (email && 0 < email.length && 'undefined' != email) {
			emailList.push(email);
		}
		else {
			tr.log(5,m,'No email available for user ' + username);
		}
	}

	// Get local hostname on which this TMCA process is running.
	var tmcahostname = os.hostname();

	// Send emails.
	if (0 < emailList.length) {		
		tr.log(5,m,'Sending email.\n' + emailList + '\n' + subject + '\n' + message);
		var dateNow = new Date();

		nodeMailWrapper.sendEmail( 
			emailList, 
			subject, // + ' (' + dateNow.getTime() + ')',
			message + '\n\nSent from Test Machine Control Application on ' + tmcahostname + '\n\nServer time: ' + dateNow, 
			function(err,results) {
				console.log('sendEmailCallback:', err, results);
			}
		);
	}
}


/**
 * Returns the object for the specified user.
 * Returns an empty object if not found.
 */
function getUser(username) {
	var not_found = {};
	for (var i=0; i<users.length; i++) {
		var user = users[i];
		if (username == user.name) {
			return user;
		}
	}	
	return not_found;
}


/**
 * Indicates if the specified user name is a valid user.
 */
function isValidUser(username) {
	for (var i=0; i<users.length; i++) {
		var user = users[i];
		if (username == user.name) {
			return true;
		}
	}	
	return false;
}


/**
 * Indicates whether the specified user has MSDN license (ie, looks for "msdn":"true" in users.json)
 */
function userHasMSDN(username) {
	for (var i=0; i<users.length; i++) {
		var user = users[i];
		if (username == user.name) {
			key = "msdn";
			if (user.hasOwnProperty(key)) {
				msdn = user[key];
				return ("true" == msdn);
			}
			return false;
		}
	}	
	return false;
}


/**
 * Indicates whether the specified device is known.
 */
function isKnownDevice(devicename) {
	var device = getDeviceByName(devicename);
	return (undefined != device);
}
	

/**
 * Indicates whether the specified device is a virtual machine.
 */
function isVirtualMachine(devicename) {
	var device = getDeviceByName(devicename);
	return (device && 'virtual' == device.machinetype);
}


/**
 * Indicates whether a device is leased or not.
 */
function isAvailable(name) {
	var lease = getLeaseByName(name);
	return (lease && "true" == lease.available);
}



/**
 * Indicates whether the user is lessee for the device.
 */
function userLeasesDevice(devicename, lessor) {
	var lease = getLeaseByName(devicename);
	return (lease && "false" == lease.available && lessor == lease.lessor);
}


/**
 * Helper method leases a device.
 */
function leaseDevice(req, device, lessor, res) {
	var m = "leaseDevice";
	tr.log(5,m,"Entry."); // device: " + JSON.stringify(device));

	// Authenticate lessor.
	if (!isValidUser(lessor)) {
		return sendErrorResponse(res,{},m,"ERROR. User not recognized as valid user. lessor=" + lessor);
	}

	// Mark the device as leased.
	markLeased(device.name, lessor);

	// Respond to requestor.
	// TODO: Standardize this return object.
	lease = getLeaseByName(device.name);
	var rcDevice = cloneDevice(device, lease);
	var rc = [ rcDevice ];
	res.send(rc);

	// Record activity.
	recordActivityHelper(req, lessor, device.name, "Leased");

	console.log('activity:\n' + JSON.stringify(activityCache));

	// Suppress frequent emails.
	if (UPDATE_USER == lessor) {
		tr.log(5,m,"Exit early. Not sending email to admin user for update user.  Too much spam.");
		return;
	}
	if (HEALTH_USER == lessor) {
		tr.log(5,m,"Exit early. Not sending email for health user.  Too much spam.");
		return;
	}
	if (-1 < lessor.indexOf(TEST_USER)) {
		tr.log(5,m,"Exit early. Not sending email for user " + lessor + ". Too much spam.");
		return;
	}

	// Send email.
	var usernameList = ((ADMIN_USER == lessor) ? [ ADMIN_USER ] : [ ADMIN_USER, lessor ]);
	var lessorSocket = req.connection;
	var lessorAddress = lessorSocket.remoteAddress;
	sendEmail( usernameList,
		lessor + '/' + lessorAddress + ' leased ' + device.name, 
		'');

	tr.log(5,m,"Exit");
}


/**
 * Helper method initializes a device, then leases it.
 */
function initAndLeaseDevice(req, device, lessor, res) {
	var m = "initAndLeaseDevice";
	tr.log(5,m,"Entry.");

	var name = device.name
	tr.log(5,m,"name=" + name);
	
	if (isVirtualMachine(name)) {
		tr.log(5,m,"Handling virtual machine. name=" + name);
	
		// Get the hypervisor for the VM
		var hypervisor = getHypervisor(name);
		tr.log(5,m,"hypervisor=" + hypervisor);
		if (!hypervisor) {
			return sendErrorResponse(res,{},m,"ERROR. Could not find hypervisor for VM: " + name);
		}

		// Get the snapshot name for the VM
		// var snapshotname = getSnapshotName(name);
		var snapshotname = snapshots.getSnapshotName(name);

		// Get miscellaneous information which may be required by the hypervisor.
		var blob = getBlob(name, lessor);

		// Initialize the VM
		tr.log(5,m,"Calling hypervisor " + hypervisor.getName() + ".leaseVM(" + name + ", " + snapshotname + ")");
		hypervisor.leaseVM(name, snapshotname, blob, function(err,rspObj) {
			var m = "initAndLeaseCallback";
			tr.log(5,m,"Entry. err=" + err);
			if (err || 0 != rspObj.rc) {
				var msg = "ERROR. VM did not initialize. lessor=" + lessor + " name=" + name;
				if (rspObj) msg += " " + rspObj.msg;
				return sendErrorResponse(res,{},m,msg);
			}
	
			tr.log(5,m,"VM is initialized. name=" + name);
			leaseDevice(req, device, lessor, res);
		});
	}
	else {
		tr.log(5,m,"Handling real machine. name=" + name);
		leaseDevice(req, device, lessor, res);
	}

	tr.log(5,m,"Exit.");
}


/**
 * Compares two comma-seperated lists in strings.
 * Returns true if list 1 contains all the contents of list 2.
 * Returns true if list 2 is empty.
 */
var list1ContainsList2 = function(stringList1, stringList2) {
	if (0 == stringList2.length) return true;
	var list1 = stringList1.split(",");
	var list2 = stringList2.split(",");
	for (var i=0; i<list2.length; i++) {
		if (-1 == list1.indexOf(list2[i])) {
			return false;
		}
	}
	return true;
}

/**
 * Compares desired properties with actual properties.
 */
var matchContentsOsBits = function(device, desiredContents, desiredOS, desiredBits) {
	return (list1ContainsList2(device.contents, desiredContents) && 
			device.os == desiredOS && 
			(desiredBits == "" || desiredBits == "0" || device.bits == desiredBits));
}


/**
 * Indicates if a user is 'special'.
 */
var isUserSpecial = function(user) {
	var m = "isUserSpecial: ";
	tr.log(5,m,"Entry. user=" + user);

	if ((ADMIN_USER == user) || (UPDATE_USER == user) || (HEALTH_USER == user) || (TEST_USER == user)) {
		tr.log(5,m,"Exit. Returning true because user is special: " + user);
		return true;
	}
	tr.log(5,m,"Exit. Returning false because user is not special: " + user);
	return false;
}


/**
 * Indicates if the lessor is permitted to lease the specified device.
 */
var isLeasePermitted = function(device, lessor) {
	var m = "isLeasePermitted: ";
	tr.log(5,m,"Entry. device.name=" + device.name + " lessor=" + lessor);

	if (isUserSpecial(lessor)) {
		tr.log(5,m,"Exit. Returning true because lessor is a privileged user: " + lessor);
		return true;
	}

	permittedUserList = []
	if (device.hasOwnProperty("permittedusers")) {
		permittedUsers = device["permittedusers"]
		permittedUserList = permittedUsers.split(",");
	}
	tr.log(5,m,"permittedUserList.length=" + permittedUserList.length + " list: " + util.inspect(permittedUserList));

	if (0 == permittedUserList.length) {
		tr.log(5,m,"Exit. Returning true because permittedUserList is empty.");
		return true;
	}

	for (var i=0; i<permittedUserList.length; i++) {
		permittedUser = permittedUserList[i];
		if (lessor == permittedUser) {
			tr.log(5,m,"Exit. Returning true because lessor is in permittedUserList.");
			return true;
		}
		//else {
		//	tr.log(5,m,"No match. permittedUser=" + permittedUser + " lessor=" + lessor);
		//}
	}

	tr.log(5,m,"Exit. Returning false because permittedUserList does not contain lessor name.");
	return false;
}


/**
 * Leases a device which matches the specified:
 *		Contents (example: tomcat7, websphere8), 
 *		OS (example: linux, windows), and 
 *		architecture bits (ie, 32 or 64).
 * If successful, returns all characteristics about the device.
 * Otherwise, returns an empty list.
 *
 * Note: bits may be an empty string "" or zero "0".  These serve as wildcards.
 *
 * Example:
 * Request: curl -v -H "Content-Type: application/json" -X POST -d '{ "contents":"tomcat", "os":"linux", "bits": 32, "lessor":"fred" }' http://localhost:7890/pool/leaseDeviceByContentsOSBits
 * Response:  [{ "name": "dingHTC", 
 *               "os": "android2.3", 
 *               "hostname": "dingp.raleigh.ibm.com", 
 *               "available": "false", 
 *               "lessor": "fred" }]
 */
function leaseDeviceByContentsOSBits(req, res) {
	var m = "leaseDeviceByContentsOSBits";
	logClientRequest(req);
	tr.log(5,m,"Entry.");	

	// Extract the desired operating system and lessor name from the request.
	var desiredContents = req.body.contents;
	var desiredOS = req.body.os;
	var desiredBits = req.body.bits;
	var lessor = req.body.lessor;
	tr.log(5,m,"desiredContents=" + desiredContents + " desiredOS=" + desiredOS + " desiredBits=" + desiredBits + " lessor=" + lessor);

	// Search for an available device.
	found = false;
	for (var i=0; i<devices.length; i++) {
		var device = devices[i];
		var lease = getLeaseByName(device.name);
		/*
		tr.log(5,m,"Considering i=" + i + 
			" name=" + device.name + 
			" contents=" + device.contents + 
			" os=" + device.os + 
			" bits=" + device.bits + 
			" available=" + lease.available);
		*/
		if (matchContentsOsBits(device, desiredContents, desiredOS, desiredBits) &&
			lease.available == 'true' &&
			isLeasePermitted(device, lessor)) {
			tr.log(5,m,"match. i=" + i + 
				" name=" + device.name + 
				" contents=" + device.contents + 
				" os=" + device.os + 
				" bits=" + device.bits + 
				" available=" + lease.available);
			found = true;

			initAndLeaseDevice(req, device, lessor, res);

			break;
        }
		//else {
		//	tr.log(5,m,"no match.");
		//}
	}

	if (found) {
		tr.log(5,m,"Exit. Found device. Awaiting leasing the device.");
	}
	else {
		// TODO: Standardize this response object.
		tr.log(5,m,"Exit. Returning empty list");
		res.send([]);
	}
}

/**
 * Leases a device which matches the specified OS.  
 * If successful, returns all characteristics about the device.
 * Otherwise, returns an empty list.
 *
 * Example:
 * Request: curl -v -H "Content-Type: application/json" -X POST -d '{ "os":"android2.3","lessor":"fred" }' http://localhost:7890/pool/leaseDeviceByOS
 * Response:  [{ "name": "dingHTC", 
 *               "os": "android2.3", 
 *               "hostname": "dingp.raleigh.ibm.com", 
 *               "available": "false", 
 *               "lessor": "fred" }]
 */
function leaseDeviceByOS(req, res) {
	var m = "leaseDeviceByOS";
	logClientRequest(req);
	tr.log(5,m,"Entry.");	

	// Extract the desired operating system and lessor name from the request.
	var desiredOS = req.body.os;
	var lessor = req.body.lessor;
	tr.log(5,m,"desiredOS=" + desiredOS + " lessor=" + lessor);

	// Search for an available device.
	found = false;
	for (var i=0; i<devices.length; i++) {
		var device = devices[i];
		var lease = getLeaseByName(device.name);
		/*
		tr.log(5,m,"Considering i=" + i + 
			" name=" + device.name + 
			" os=" + device.os + 
			" available=" + lease.available);
		*/
		if (device.os == desiredOS && 
			lease.available == 'true' &&
			isLeasePermitted(device, lessor)) {
			tr.log(5,m,"match. i=" + i + 
				" name=" + device.name + 
				" os=" + device.os + 
				" available=" + lease.available);
			found = true;

			initAndLeaseDevice(req, device, lessor, res);

			break;
        }
		//else {
		//	tr.log(5,m,"no match.");
		//}
	}

	if (found) {
		tr.log(5,m,"Exit. Found device. Awaiting leasing the device.");
	}
	else {
		// TODO: Standardize this response object.
		tr.log(5,m,"Exit. Returning empty list");
		res.send([]);
	}
}

/**
 * Leases a device which matches the specified device name.  
 * If successful, returns all characteristics about the device.
 * Otherwise, returns an empty list.
 *
 * Example:
 * Request: curl -v -H "Content-Type: application/json" -X POST -d '{ "name":"dingHTC","lessor":"fred" }' http://localhost:7890/pool/leaseDeviceByName
 * Response:  [{ "name": "dingHTC", 
 *               "os": "android2.3", 
 *               "hostname": "dingp.raleigh.ibm.com", 
 *               "available": "false", 
 *               "lessor": "fred" }]
 */
function leaseDeviceByName(req, res) {
	var m = "leaseDeviceByName";
	logClientRequest(req);
	tr.log(5,m,"Entry.");	

	// Extract the desired device name and lessor name from the request.
	var desiredDeviceName = req.body.name;
	var lessor = req.body.lessor;
	tr.log(5,m,"desiredDeviceName=" + desiredDeviceName + " lessor=" + lessor);

	// Search for the device.
	found = false;
	for (var i=0; i<devices.length; i++) {
		var device = devices[i];
		var lease = getLeaseByName(device.name);
		/*
		tr.log(5,m,"Considering i=" + i + 
			" name=" + device.name + 
			" os=" + device.os + 
			" available=" + lease.available);
		*/
		if (device.name == desiredDeviceName && 
			lease.available == 'true' &&
			isLeasePermitted(device, lessor)) {
			tr.log(5,m,"Match. " + 
				" name=" + device.name + 
				" os=" + device.os + 
				" available=" + lease.available);
			found = true;

			initAndLeaseDevice(req, device, lessor, res);

			break;
        }
		//else {
		//	tr.log(5,m,"no match.");
		//}
	}

	if (found) {
		tr.log(5,m,"Exit. Found device. Awaiting leasing the device.");
	}
	else {
		// TODO: Standardize this response object.
		tr.log(5,m,"Exit. Returning empty list.");
		res.send([]);
	}
}

/**
 * FOR DEBUG ONLY
 * Sleeps for the specified time, then returns success.
 * Useful for debugging premature timeouts for slow operations.
 *
 * Example: TBD
 * Request: curl -v -H "Content-Type: application/json" -X POST -d '{ "seconds":"123" }' http://localhost:7890/pool/slowsrv/
 * Response:  [{ n/a }]
 */
function slowsrv(req, res) {
	var m = "slowsrv";
	logClientRequest(req);
	tr.log(5,m,"Entry.");

	// SECRET!!! Increase the socket timeout to 6 minutes (360K ms)
	req.connection.setTimeout(6 * 60 * 1000);

	// Extract the desired device name and lessor name from the request.
	var seconds = req.body.seconds;
	tr.log(5,m,"seconds=" + seconds);

	setTimeout(function() {
		var m = "slowsrvCallback";
		tr.log(5,m,"Entry.");
		var msg = "Sleep complete. seconds=" + seconds;
		tr.log(5,m,msg);
		rc = {};
		rc['rc'] = 0;
		rc['msg'] = msg;
		res.send([rc]);
		tr.log(5,m,"Exit.");
	}, seconds);

	tr.log(5,m,"Exit.");	
}

/**
 * Helper method unleases a device.
 */
function unleaseDevice(req, rc, device, res) {
	var m = "unleaseDevice";
	tr.log(5,m,"Entry.");// device=" + JSON.stringify(device));	
	tr.log(5,m,"device=" + util.inspect(device));

	var lease = getLeaseByName(device.name);

	// Remember the lessor.
	var lessor = lease.lessor;

	// Mark the device as available.
	markUnleased(device.name);

	// Respond to requestor.
	var msg = "Unleased device ok. device=" + device.name; 
	tr.log(5,m,msg);
	rc['rc'] = 0;
	rc['msg'] = msg;
	//tr.log(5,m,"Responding with object rc: " + util.inspect(rc));
	res.send([rc]);

	// Record activity.
	recordActivityHelper(req, lessor, device.name, "Unleased");

	// Suppress frequent emails.
	if (UPDATE_USER == lessor) {
		tr.log(5,m,"Exit early. Not sending email to admin user for update user.  Too much spam.");
		return;
	}
	if (HEALTH_USER == lessor) {
		tr.log(5,m,"Exit early. Not sending email for health user.  Too much spam.");
		return;
	}
	if (-1 < lessor.indexOf(TEST_USER)) {
		tr.log(5,m,"Exit early. Not sending email for user " + lessor + ". Too much spam.");
		return;
	}

	// Send email.
	var usernameList = ((ADMIN_USER == lessor) ? [ ADMIN_USER ] : [ ADMIN_USER, lessor ]);
	var lessorSocket = req.connection;
	var lessorAddress = lessorSocket.remoteAddress;
	sendEmail( usernameList,
		lessor + '/' + lessorAddress + ' unleased ' + device.name, 
		'');

	tr.log(5,m,"Exit");
}

/**
 * Un-leases a device.
 * Returns an empty list.
 *
 * Example:
 * Request: curl -v -H "Content-Type: application/json" -X POST -d '{ "name":"dingHTC", "lessor":"fred"  }' http://localhost:7890/pool/unleaseDeviceByName
 * Response:  []
 */
function unleaseDeviceByName(req, res) {
	var m = "unleaseDeviceByName";
	logClientRequest(req);
	tr.log(5,m,"Entry.");	

	// Extract the device name from the request.
	var name = req.body.name;
	var lessor = req.body.lessor;
	tr.log(5,m,"name=" + name + " lessor=" + lessor);
	var rc = { 'name': name, 'action': m, "lessor": lessor };

	// Get the device
	var device = getDeviceByName(name);
	if (!device) {
		tr.log(5,m,"ERROR: Could not find device " + name);
		return;
	}
    tr.log(5,m,"device=" + util.inspect(device));

	// Get the lease
	var lease = getLeaseByName(device.name);

	// Verify device is leased.
	if ('false' != lease.available) {
		return sendErrorResponse(res,rc,m,"ERROR. Device is not leased. lessor=" + lessor + " name=" + name);
	}

	// Verify device is leased by lessor.
	if (lessor != lease.lessor) {
		return sendErrorResponse(res,rc,m,"ERROR. User is not lessee. name=" + name);
	}

	// Unlease real machines.
	if ('virtual' != device.machinetype) {
		// Real machine.  Unlease it.
		return unleaseDevice(req, rc, device, res);
	}

	// Get the hypervisor for the VM
	var hypervisor = getHypervisor(name);
	tr.log(5,m,"hypervisor=" + hypervisor);
	if (!hypervisor) {
		return sendErrorResponse(res,rc,m,"ERROR. Could not find hypervisor for VM: " + name);
	}

	// Get miscellaneous information which may be required by the hypervisor.
	var blob = getBlob(name, lessor);

	// Execute command
	tr.log(5,m,"Calling hypervisor.isRunning(" + name + ")");
	hypervisor.isRunning(name, blob, function(err, running) {
		var m = "unleaseDeviceByNameCallback";
		tr.log(5,m,"Entry. err=" + err + " running=" + running);
		if (err) {
			tr.log(5,m,err);
			return sendErrorResponse(res,rc,m,"ERROR getting VM status. " + name);
		}
		// Object value.
		if ('rc' in running) {
			tr.log(5,m,"Handling response object: " + util.inspect(running));
			if (0 != running.rc) {
				return sendErrorResponse(res,rc,m,"ERROR getting VM status. " + name);
			}
			if ('running' in running) {
				running = running.running;
			}
			else if ('active' in running) {
				running = running.active;
			}
			else {
				tr.log(5,m,"WARNING: Unrecognized object.");
			}
		}

		// Boolean value.
		if (running) {
			return sendErrorResponse(res,rc,m,"ERROR. Can not unlease because VM is running. lessor=" + lessor + " name=" + name);
		}

		if (isVirtualMachine(name)) {
			// Uninitialize the VM
			tr.log(5,m,"Calling hypervisor " + hypervisor.getName() + ".unleaseVM(" + name + ")");
			hypervisor.unleaseVM(name, blob, function(err,rspObj) {
				var m = "unleaseUnleaseCallback";
				if (err) {
					tr.log(5,m,"WARNING. VM did not uninitialize. lessor=" + lessor + " name=" + name + " err: " + err);
				}
				if (rspObj) {
					tr.log(5,m,"rc=" + rspObj.rc + " msg=" + rspObj.msg);
				}

				// Device is not running.  Unlease.
				return unleaseDevice(req, rc, device, res);
			});
		}
		else {
			// Device is real.  Unlease.
			return unleaseDevice(req, rc, device, res);
		}
	});
}



/**
 * Adds a device to the json file.
 *
 * Example:
 * Request: curl -v -H "Content-Type: application/json" -X POST -d '{ "name":"fredVM8","os":"zos","hostname":"fredvm8.rtp.raleigh.ibm.com","available":"false","lessor":"n/a" }' http://localhost:7890/pool/addDevice
 * Response:  [{ "name": "fredVM8, 
 *               "os": "zos", 
 *               "hostname": "fredvm8.rtp.raleigh.ibm.com", 
 *               "available": "false", 
 *               "lessor": "n/a" }]
 */
function addDevice(req, res) {
	var m = "addDevice";
	logClientRequest(req);
	tr.log(5,m,"Entry. req: " + req);	

	// Extract args from the request.
	var newdevice = {}
	// Note: Be sure to update this section when the device 'schema' changes.
	newdevice.name = req.body.name;
	newdevice.os = req.body.os;
	newdevice.contents = req.body.contents;
	newdevice.distro = req.body.distro;
	newdevice.bits = req.body.bits;
	newdevice.hostname = req.body.hostname;
    tr.log(5,m,"newdevice=" + util.inspect(newdevice));

	// TODO: Add arg value checking here

    // Ensure the device does not already exist.
	if (getDeviceByName(newdevice.name)) {
		tr.log(5,m,"Exit. Error. Device already exists. name=" + name);
		res.send([]);
		return;
	}

/*
	tr.log(5,m,"devlics.length=" + devices.length);
	for (var i=0; i<devices.length; i++) {
		tr.log(5,m,"i=" + i + " newdevice.name=" + newdevice.name + " devices[i].name="  + devices[i].name);
		if (newdevice.name == devices[i].name) {
			tr.log(5,m,"Exit. Error. Device already exists. name=" + name);
			res.send([]);
			return;
		}
	}
*/	
	// Add the new device to the list.
	devices.push(newdevice);

	// Save to file.
	fs.writeFileSync(DEVICES_FILENAME, JSON.stringify(devices));

	tr.log(5,m,"Exit.");
	res.send([]);
}

/**
 * Removes a device from the json file.
 *
 * Example:
 * Request: curl -v -H "Content-Type: application/json" -X POST -d '{ "name":"fredVM8" }' http://localhost:7890/pool/removeDevice
 * Response:  []
 */
function removeDevice(req, res) {
	var m = "removeDevice";
	logClientRequest(req);
	tr.log(5,m,"Entry.");	

	// Extract the device name from the request.
	var name = req.body.name
	tr.log(5,m,"name=" + name);

	// Search for the specific device.
	for (var i=0; i<devices.length; i++) {
		var device = devices[i];
		var lease = getLeaseByName(device.name);
		/*
		tr.log(5,m,"Considering i=" + i + 
			" name=" + device.name + 
			" os=" + device.os + 
			" available=" + lease.available);
		*/
		if (device.name == name) {
			tr.log(5,m,"Match. " +
				" name=" + device.name + 
				" os=" + device.os + 
				" available=" + lease.available);
			// Delete the device from the list
			devices.splice(i,1);
			// Save to file.
			fs.writeFileSync(DEVICES_FILENAME, JSON.stringify(devices));

			removeLeaseByName(device.name);
			break;
        }
		//else {
		//	tr.log(5,m,"no match.");
		//}
	}
	tr.log(5,m,"Exit.");
	res.send([]);
}


/**
 * Indicates whether a lease is expired.
 */
var isLeaseExpired = function(lease) {
	var m = "isLeaseExpired: ";
	//tr.log(5,m,"Entry. maxLeaseMs=" + maxLeaseMs + " lease=" + util.inspect(lease));

	if ("false" == lease.available && "n/a" != lease.leasetimestamp) {
		var timeNow = (new Date()).getTime();
		if (timeNow > (lease.leasetimestamp + maxLeaseMs)) {
			tr.log(5,m,"Exit. Returning true. Lease is EXPIRED. name=" + lease.name);
			return true;
		}
	}

	//tr.log(5,m,"Exit. Returning false. Lease is not expired. name=" + lease.name);
	return false;
}

/**
 * Constants for time calculations.
 */
MINUTE_MS = 60 * 1000;
HOUR_MS = 60 * MINUTE_MS;
HOURS_4_MS = 4 * HOUR_MS;
HOURS_24_MS = 24 * HOUR_MS;

/**
 * Indicates whether we can send another warning email to lessee.
 * This function limits one email per day for an expired lease.
 */
var canSendEmail = function(lease) {
	var m = "canSendEmail: ";
	//tr.log(5,m,"Entry. maxLeaseMs=" + maxLeaseMs + " lease=" + util.inspect(lease));
	var timeNow = (new Date()).getTime();

	if (isLeaseExpired(lease)) {
		if ("n/a" == lease.emailtimestamp) {
			tr.log(5,m,"Exit. Returning true. First email may be sent. name=" + lease.name);
			return true;
		}
		else if (timeNow > (lease.emailtimestamp + HOURS_24_MS)) {
			tr.log(5,m,"Exit. Returning true. Repeat email may be sent. name=" + lease.name);
			return true;
		}
		else {
			//tr.log(5,m,"Exit. Returning false. Repeat email may not be sent yet. name=" + lease.name);
			return false;
		}
	}
	else {
		//tr.log(5,m,"Exit. Returning false. Lease is not expired. name=" + lease.name);
		return false;
	}
}


/**
 * Returns a humanly-readable string indicating the approximate age of the lease.
 */
var getLeaseAgeString = function(lease) {

	if ("false" != lease.available || "n/a" == lease.leasetimestamp) {
		return "n/a";
	}

	var timeNow = (new Date()).getTime();
	var leaseAgeMs = timeNow - lease.leasetimestamp;

	if (leaseAgeMs > HOURS_24_MS) {
		return "" + (Math.floor(leaseAgeMs/HOURS_24_MS)) + "+ days";
	}
	if (leaseAgeMs > HOUR_MS) {
		return "" + (Math.floor(leaseAgeMs/HOUR_MS)) + "+ hours";
	}
	if (leaseAgeMs > MINUTE_MS) {
		return "" + (Math.floor(leaseAgeMs/MINUTE_MS)) + "+ minutes";
	}
	return "" + leaseAgeMs + " ms"
}


/**
 * Checks for expired leases.
*/
var monitorLeaseDuration = function () {
	var m = 'monitorLeaseDuration: ';
	tr.log(5,m,'Entry');

	// Check every 1 hour.
	sleepMs = HOUR_MS;

	// Infinite loop.
	setInterval( function() {
		var m = 'monitorLeaseDurationCallback: ';
		tr.log(5,m,"Entry.");

		for (var i=0; i<leases.length; i++) {
			var lease = leases[i];

			var device = getDeviceByName(lease.name);
			if (null != device && canSendEmail(lease)) {

				// Send email to lessee.
				var lessor = lease.lessor;
				var usernameList = ((ADMIN_USER == lessor) ? [ ADMIN_USER ] : [ ADMIN_USER, lessor ]);
				var subject = "Lease expired: " + lease.name + " " + lessor;
				var message = "Device " + lease.name + " has been leased " + getLeaseAgeString(lease) + ".";
				message += " Please unlease when finished.";
				message += " Contact John Doe (johndoe@us.ibm.com) with questions.";
				sendEmail(usernameList, subject, message);

				tr.log(5,m,"Sent email to " + lessor + ": " + subject);

				// Update email timestamp to limit sending emails too frequently.
				lease.emailtimestamp = (new Date()).getTime();

				// Save to file.
				fs.writeFileSync(LEASES_FILENAME, JSON.stringify(leases));
			}
			else {
				//tr.log(5,m,"ok " + msg);
			}
		}
	}, sleepMs);

	tr.log(5,m,'Exit. sleepMs=' + sleepMs);
}



/**
 * Helper method sends an error response.
 */
function sendErrorResponse(res,rc,m,msg) {
	tr.log(5,m,msg);
	rc['rc'] = -1;
	rc['msg'] = msg;
	if (res) res.send([rc]);
}

/**
 * Helper method sends a success response.
 */
function sendSuccessResponse(res,rc,m,msg) {
	tr.log(5,m,msg);
	rc['rc'] = 0;
	rc['msg'] = msg;
	if (res) res.send([rc]);
}


/**
 * Restores the 'master' snapshot of a VirtualBox VM.
 * Prereq:  Requires that a snapshot named 'master' exist.
 * Returns an empty list on success.
 *
 * Example:
 * Request: curl -v -H "Content-Type: application/json" -X POST -d '{ "name":"wltestu2", "lessor":"fred" }' http://localhost:7890/pool/restoreVM
 * Response:  []
 */
function restoreVM(req, res) {
	var m = "restoreVM";
	logClientRequest(req);
	tr.log(5,m,"Entry.");	
	var rc = { 'name': name, 'action': 'restoreVM' };

	// Extract the device name from the request.
	var name = req.body.name
	var lessor = req.body.lessor;
	tr.log(5,m,"name=" + name + " lessor=" + lessor);

	// Verify the device is a VM, device is leased, and user holds the lease.
	if (!readyForHypervisor(name, lessor)) {
		return sendErrorResponse(res,rc,m,"ERROR. User is not lessee. name=" + name);
	}

	// Get the hypervisor for the VM
	var hypervisor = getHypervisor(name);
	tr.log(5,m,"hypervisor=" + hypervisor);
	if (!hypervisor) {
		return sendErrorResponse(res,rc,m,"ERROR. Could not find hypervisor for VM: " + name);
	}

	// Get the snapshot name for the VM
	// var snapshotname = getSnapshotName(name);
	var snapshotname = snapshots.getSnapshotName(name);

	// Get miscellaneous information which may be required by the hypervisor.
	var blob = getBlob(name, lessor);

	// Execute command
	tr.log(5,m,"Calling hypervisor " + hypervisor.getName() + ".restoreVM(" + name + ", " + snapshotname + ")");
	hypervisor.restoreVM(name, snapshotname, blob, function(err) {
		var m = "restoreVMCallback";
		if (err) {
			tr.log(5,m,err);
			sendErrorResponse(res,rc,m,"ERROR restoring VM " + name + " " + util.inspect(err));
		}
		else {
			sendSuccessResponse(res,rc,m,"Restored VM " + name);
			recordActivityHelper(req, lessor, name, "Restored");
		}
		tr.log(5,m,"Exit.");
	});

	tr.log(5,m,'Exit');
}


/**
 * Starts a VirtualBox VM.
 * Returns an empty list on success.
 * 
 * Example:
 * Request: curl -v -H "Content-Type: application/json" -X POST -d '{ "name":"wltestu2", "lessor":"fred" }' http://localhost:7890/pool/startVM/
 * Response:  [ {"name": "wltestu0",  "action": "startVM",  "msg": "Started VM wltestu0",  "rc": 0} ]
 */
function startVM(req, res) {
	var m = "startVM";
	logClientRequest(req);
	tr.log(5,m,"Entry.");	
	var rc = { 'name': name, 'action': 'startVM' };

	// Important for slow-starting VMs: Increase the socket timeout.
	req.connection.setTimeout(6 * 60 * 1000);  // 6 minutes

	// Extract the device name from the request.
	var name = req.body.name
	var lessor = req.body.lessor;
	tr.log(5,m,"name=" + name + " lessor=" + lessor);

	// Verify the device is a VM, device is leased, and user holds the lease.
	if (!readyForHypervisor(name, lessor)) {
		return sendErrorResponse(res,rc,m,"ERROR. User is not lessee. name=" + name);
	}

	// Get the hypervisor for the VM
	var hypervisor = getHypervisor(name);
	tr.log(5,m,"name=" + name + " hypervisor=" + hypervisor);
	if (!hypervisor) {
		return sendErrorResponse(res,rc,m,"ERROR. Could not find hypervisor for VM: " + name);
	}

	// Get the snapshot name for the VM
	// var snapshotname = getSnapshotName(name);
	var snapshotname = snapshots.getSnapshotName(name);

	// Get miscellaneous information which may be required by the hypervisor.
	var blob = getBlob(name, lessor);

	// Execute command
	tr.log(5,m,"Calling hypervisor " + hypervisor.getName() + ".startVM(" + name + ", " + snapshotname + ")");
	hypervisor.startVM(name, snapshotname, blob, function(err) {
		var m = "startVMCallback";
		if (err) {
			tr.log(5,m,"name=" + name + " Received error:");
			tr.log(5,m,err);
			sendErrorResponse(res,rc,m,"ERROR starting VM " + name + " " + util.inspect(err));
		}
		else {
			tr.log(5,m,"name=" + name + " No error. Reporting success.");
			sendSuccessResponse(res,rc,m,"Started VM " + name);
			recordActivityHelper(req, lessor, name, "Started");
		}
		tr.log(5,m,"Exit. name=" + name);
	});

	tr.log(5,m,"Exit. name=" + name);
}


/**
 * Stops a VirtualBox VM.
 * Returns an empty list on success.
 *
 * Example:
 * Request: curl -v -H "Content-Type: application/json" -X POST -d '{ "name":"wltestu2", "lessor":"fred" }' http://localhost:7890/pool/stopVM/
 * Response:  []
 */
function stopVM(req, res) {
	var m = "stopVM";
	logClientRequest(req);
	tr.log(5,m,"Entry.");	
	var rc = { 'name': name, 'action': 'stopVM' };

	// Extract the device name from the request.
	var name = req.body.name
	var lessor = req.body.lessor;
	tr.log(5,m,"name=" + name + " lessor=" + lessor);

	// Verify the device is a VM, device is leased, and user holds the lease.
	if (!readyForHypervisor(name, lessor)) {
		return sendErrorResponse(res,rc,m,"ERROR. User is not lessee. name=" + name);
	}

	// Get the hypervisor for the VM
	var hypervisor = getHypervisor(name);
	tr.log(5,m,"hypervisor=" + hypervisor);
	if (!hypervisor) {
		return sendErrorResponse(res,rc,m,"ERROR. Could not find hypervisor for VM: " + name);
	}

	// Get miscellaneous information which may be required by the hypervisor.
	var blob = getBlob(name, lessor);

	// Execute command
	tr.log(5,m,"Calling hypervisor " + hypervisor.getName() + ".stopVM(" + name + ")");
	hypervisor.stopVM(name, blob, function(err) {
		var m = "stopVMCallback";
		if (err) {
			tr.log(5,m,err);
			sendErrorResponse(res,rc,m,"ERROR stopping VM " + name + " " + util.inspect(err));
		}
		else {
			sendSuccessResponse(res,rc,m,"Stopped VM " + name);
			recordActivityHelper(req, lessor, name, "Stopped");
		}
		tr.log(5,m,"Exit.");
	});

	tr.log(5,m,'Exit');
}


/**
 * Stops, retores, and unleases a Virtual Machine.
 *
 * Warning: Does not work with vLaunch (because vLaunch reboots VMs after restore)
 * 
 * 2016-0107-1200 New feature request from Danny B
 *
 * Example:
 * Request: curl -v -H "Content-Type: application/json" -X POST -d '{ "name":"wltestu2", "lessor":"fred" }' http://localhost:7890/pool/stopRestoreUnleaseVM
 * Response:  
 */
function stopRestoreUnleaseVM(req, res) {
	private_stopRestoreUnleaseVM(req, res, true);
}


/**
 * Stops and unleases a Virtual Machine.
 *
 * Example:
 * Request: curl -v -H "Content-Type: application/json" -X POST -d '{ "name":"wltestu2", "lessor":"fred" }' http://localhost:7890/pool/stopUnleaseVM
 * Response:  
 */
function stopUnleaseVM(req, res) {
	private_stopRestoreUnleaseVM(req, res, false);
}


/**
 * Helper function stops, retores, and unleases a Virtual Machine.
 */
function private_stopRestoreUnleaseVM(req, res, doRestore) {
	var m = "stopRestoreUnleaseVM";
	logClientRequest(req);
	tr.log(5,m,"Entry. doRestore=" + doRestore);	
	var rc = { 'name': name, 'action': 'stopRestoreUnleaseVM' };

	// Extract the device name from the request.
	var name = req.body.name
	var lessor = req.body.lessor;
	tr.log(5,m,"name=" + name + " lessor=" + lessor);

	// Verify the device is a VM, device is leased, and user holds the lease.
	if (!readyForHypervisor(name, lessor)) {
		return sendErrorResponse(res,rc,m,"ERROR. User is not lessee. name=" + name);
	}

	// Get the hypervisor for the VM
	var hypervisor = getHypervisor(name);
	tr.log(5,m,"hypervisor=" + util.inspect(hypervisor));
	if (!hypervisor) {
		return sendErrorResponse(res,rc,m,"ERROR. Could not find hypervisor for VM: " + name);
	}

	// Reject restore operations on vLaunch hypervisor, since vLaunch automatically reboots the VM after restore.
	if (doRestore && "vlaunch" == hypervisor.getName()) {
		return sendErrorResponse(res,rc,m,"ERROR. Sorry, operations stop, restore, and unlease are not supported with hypervisor vLaunch.");
	}

	// Get the snapshot name for the VM
	// var snapshotname = getSnapshotName(name);
	var snapshotname = snapshots.getSnapshotName(name);

	// Get miscellaneous information which may be required by the hypervisor.
	var blob = getBlob(name, lessor);

	// Get device object for VM.
	var device = getDeviceByName(name);

	// Execute command to stop VM.
	tr.log(5,m,"Calling hypervisor " + hypervisor.getName() + ".stopVM(" + name + ")");
	hypervisor.stopVM(name, blob, function(err) {
		var m = "stopRestoreUnleaseVMCallback1";
		if (err) {
			tr.log(5,m,err);
			sendErrorResponse(res,rc,m,"ERROR stopping VM " + name + " " + util.inspect(err));
		}
		else if (doRestore) {
			// Execute command to restore VM.
			tr.log(5,m,"Calling hypervisor " + hypervisor.getName() + ".restoreVM(" + name + ", " + snapshotname + ")");
			hypervisor.restoreVM(name, snapshotname, blob, function(err) {
				var m = "stopRestoreUnleaseVMCallback2";
				if (err) {
					tr.log(5,m,err);
					sendErrorResponse(res,rc,m,"ERROR restoring VM " + name + " " + util.inspect(err));
				}
				else {
					tr.log(5,m,"Executing command to unlease VM after stop and restore.");
					return unleaseDevice(req, rc, device, res);
				}
				tr.log(5,m,"Exit.");
			});
		}
		else {
			tr.log(5,m,"Executing command to unlease VM after stop.");
			return unleaseDevice(req, rc, device, res);
		}
		tr.log(5,m,"Exit.");
	});

	tr.log(5,m,'Exit');
}


/**
 * Sets the name of the master VM snapshot.
 * Returns a list of interesting information in response.
 *
 * Example:
 * Request: curl -v -H "Content-Type: application/json" -X POST -d '{ "devicename":"wltestu2", "snapshotname":"201501300800", "lessor":"fred" }' http://localhost:7890/pool/setSnapshotName
 * 
 * Request:  curl -v -H "Content-Type: application/json" -X POST -d '{ "devicename":"vsun11a", "snapshotname":"fredflintstone", "lessor":"igor" }' http://localhost:7890/pool/setSnapshotName

 * Response:
 * [{"action":"setSnapshotName",
 *   "rc":0,
 *   "devicename":"wltestu2",
 *   "newsnapshotname":"201501300800",
 *   "msg":"Set snapshot name. device=wltestu2 snapshotname=201501300800"}]
 */
function setSnapshotName(req, res) {
	var m = "setSnapshotName";
	logClientRequest(req);
	tr.log(5,m,"Entry.");	
	var rc = { 'action': 'setSnapshotName', "devicename":devicename, "snapshotname":snapshotname };

	// Extract the device name from the request.
	var devicename = req.body.devicename;
	var snapshotname = req.body.snapshotname;
	var lessor = req.body.lessor;
	tr.log(5,m,"devicename=" + devicename + " snapshotname=" + snapshotname + " lessor=" + lessor);

	// Verify the device is valid.
	if (!isKnownDevice(devicename)) {
		return sendErrorResponse(res,rc,m,"ERROR: Device is not recognized. devicename=" + devicename + " snapshotname=" + snapshotname);
	}
	tr.log(5,m,"Device is valid.");

	// Verify the device is a VM, device is leased, and user holds the lease.
	if (!readyForHypervisor(devicename, lessor)) {
		return sendErrorResponse(res,rc,m,"ERROR. User is not lessee. devicename=" + devicename + " lessee=" + lessor);
	}
	tr.log(5,m,"Device is a VM, leased, and leased by user.");

/****
	// Verify the hypervisor supports user-settable snapshot names.
	if (!settableSnapshots(getHypervisor(devicename))) {
		return sendErrorResponse(res,rc,m,"ERROR. Hypervisor " + hypervisor.name + " does not support user-settable snapshot names.");
	}
	tr.log(5,m,"Hypervisor supports user-settable snapshot names.");
*/

	// Verify the snapshot name looks reasonable.
	if (4 > snapshotname.length) {
		return sendErrorResponse(res,rc,m,"ERROR. Snapshot name is too short. devicename=" + devicename + " snapshotname=" + snapshotname);
	}
	if (32 < snapshotname.length) {
		return sendErrorResponse(res,rc,m,"ERROR. Snapshot name is too long. devicename=" + devicename + " snapshotname=" + snapshotname);
	}
	tr.log(5,m,"Snapname looks reasonable.");


	var device = getDeviceByName(devicename);

	if (device.hasOwnProperty("owner")) {
		var owner = device['owner'];

		if (lessor == owner) {
			var oldsnapname = snapshots.getSnapshotName(devicename);
			var int_rc = snapshots.setSnapshotName(devicename, snapshotname);
			if (0 == int_rc) {
				recordActivityHelper(req, lessor, devicename, "SetSnapshotName(" + snapshotname + ")");
				return sendSuccessResponse(res,rc,m,"Ok. Set snapshot name. devicename=" + devicename + " oldsnap=" + oldsnapname + " newsnap=" + snapshotname);
			}
			else {
				return sendErrorResponse(res,rc,m,"ERROR: Could not set snapshot name. devicename=" + devicename + " snapshotname=" + snapshotname);
			}
		}
		else {
			return sendErrorResponse(res,rc,m,"ERROR: Can not set snapshot name because user is not adminstrative owner. lessee=" + lessor + " owner=" + owner);
		}
	}
	else {
		return sendErrorResponse(res,rc,m,"ERROR: Can not set snapshot name because TMCA does not know the administrator owner of device " + devicename);
	}
}

/**
 * Renames a VirtualBox VM snapshot from master to old-yyyy-mmdd-hhss-xxxx.
 * Returns a list of interesting information in response.
 *
 * Issues command like this:
 * 		vboxmanage snapshot test37 edit master --name ers
 *
 * Example:
 * Request: curl -v -H "Content-Type: application/json" -X POST -d '{ "name":"wltestu2", "lessor":"fred" }' http://localhost:7890/pool/renameSnapshot
 * 
 * Response:
 * [{"action":"renameSnapshot","rc":0,"msg":"Renamed VM snapshot for VM wllx643. oldName: master newName: old-2013-0603-2125-2122"}]
 */
function renameSnapshot(req, res) {
	var m = "renameSnapshot";
	logClientRequest(req);
	tr.log(5,m,"Entry.");	
	var rc = { 'name': name, 'action': 'renameSnapshot' };

	// Extract the device name from the request.
	var name = req.body.name;
	var lessor = req.body.lessor;
	tr.log(5,m,"name=" + name + " lessor=" + lessor);

	// Verify the device is a VM, device is leased, and user holds the lease.
	if (!readyForHypervisor(name, lessor)) {
		return sendErrorResponse(res,rc,m,"ERROR. User is not lessee. name=" + name);
	}
	
	// Verify the lessor is authorized.
	if (UPDATE_USER != lessor) {
		return sendErrorResponse(res,rc,m,"ERROR. User " + UPDATE_USER + " is not lessee. Current lessee: " + lessor);
	}

    // Define the names for snapshots.
	var oldSnapshotName = MASTER_SNAPSHOT_NAME;
	rc['oldSnapshotName'] = oldSnapshotName;
	var newSnapshotName = 'old-' + tr.getLogTimestamp();
	rc['newSnapshotName'] = newSnapshotName;

	// Get the hypervisor for the VM
	var hypervisor = getHypervisor(name);
	tr.log(5,m,"hypervisor=" + hypervisor);
	if (!hypervisor) {
		return sendErrorResponse(res,rc,m,"ERROR. Could not find hypervisor for VM: " + name);
	}

	// Get miscellaneous information which may be required by the hypervisor.
	var blob = getBlob(name, lessor);

	// Execute command
	tr.log(5,m,"Calling hypervisor.renameSnapshot(" + name + ", " + oldSnapshotName + ", " + newSnapshotName + ")");
	tr.log(5,m,"getName: " + hypervisor.getName());
	hypervisor.renameSnapshot(name, oldSnapshotName, newSnapshotName, blob, function(err) {
		if (err) {
			tr.log(5,m,err);
			sendErrorResponse(res,rc,m,"ERROR renaming snapshot. vm name=" + name);
		}
		else {
			sendSuccessResponse(res,rc,m,"Renamed snapshot. vm name=" + name + " old snapshot=" + oldSnapshotName + " new snapshot=" + newSnapshotName);
			recordActivityHelper(req, lessor, name, "Renamed snapshot.");
		}
		tr.log(5,m,"Exit.");
	});

	tr.log(5,m,'Exit');
}

/**
 * Takes a snapshot of the current VirtualBox VM.  Names it 'master'.
 * Returns a list of interesting information in response.
 *
 * Issues command like this:
 * 		vboxmanage snapshot test37 take master
 *
 * Example:
 * Request: curl -v -H "Content-Type: application/json" -X POST -d '{ "name":"wltestu2", "lessor":"fred" }' http://localhost:7890/pool/takeSnapshot
 * 
 * Response:
 * [{"action":"takeSnapshot","rc":0,"msg":"Took VM snapshot for VM wllx643. newName: master"}]
 */
function takeSnapshot(req, res) {
	var m = "takeSnapshot";
	logClientRequest(req);
	tr.log(5,m,"Entry.");	
	var rc = { 'name': name, 'action': 'takeSnapshot' };

	// Extract the device name from the request.
	var name = req.body.name
	var lessor = req.body.lessor;
	tr.log(5,m,"name=" + name + " lessor=" + lessor);

	// Verify the device is a VM, device is leased, and user holds the lease.
	if (!readyForHypervisor(name, lessor)) {
		return sendErrorResponse(res,rc,m,"ERROR. User is not lessee. name=" + name);
	}

	// Verify the lessor is authorized.
	if (UPDATE_USER != lessor) {
		return sendErrorResponse(res,rc,m,"ERROR. User " + UPDATE_USER + " is not lessee. Current lessee: " + lessor);
	}

    // Define the name for the snapshot.
	var newSnapshotName = MASTER_SNAPSHOT_NAME;
	rc['newSnapshotName'] = newSnapshotName;

	// Get the hypervisor for the VM
	var hypervisor = getHypervisor(name);
	tr.log(5,m,"hypervisor=" + hypervisor);
	if (!hypervisor) {
		return sendErrorResponse(res,rc,m,"ERROR. Could not find hypervisor for VM: " + name);
	}

	// Get miscellaneous information which may be required by the hypervisor.
	var blob = getBlob(name, lessor);

	// Execute command
	tr.log(5,m,"Calling hypervisor.takeSnapshot(" + name + ")");
	tr.log(5,m,"getName: " + hypervisor.getName());
	hypervisor.takeSnapshot(name, newSnapshotName, blob, function(err) {
		if (err) {
			tr.log(5,m,err);
			sendErrorResponse(res,rc,m,"ERROR taking snapshot. vame=" + name);
		}
		else {
			sendSuccessResponse(res,rc,m,"Took snapshot. vm name=" + name + " new snapshot=" + newSnapshotName);
			recordActivityHelper(req, lessor, name, "Took snapshot.");
		}
		tr.log(5,m,"Exit.");
	});

	tr.log(5,m,'Exit');
}

/**
 * Renames the existing master snapshot, then takes a new master snapshot.
 * Returns a list of interesting information in response.
 *
 * Issues command like this:
 * 		vboxmanage snapshot test37 edit master --name ers
 *
 * Example:
 * Request: curl -v -H "Content-Type: application/json" -X POST -d '{ "name":"wltestu2", "lessor":"fred" }' http://localhost:7890/pool/updateSnapshot
 * 
 * Response:
 * [{"action":"updateSnapshot","rc":0,"msg":"Renamed VM snapshot for VM wllx643. oldName: master newName: old-2013-0603-2125-2122"}]
 */
function updateSnapshot(req, res) {
	var m = "updateSnapshot";
	logClientRequest(req);
	tr.log(5,m,"Entry.");	
	var rc = { 'name': name, 'action': 'updateSnapshot' };

	// Extract the device name from the request.
	var name = req.body.name
	var lessor = req.body.lessor;
	tr.log(5,m,"name=" + name + " lessor=" + lessor);

	// Verify the device is a VM, device is leased, and user holds the lease.
	if (!readyForHypervisor(name, lessor)) {
		return sendErrorResponse(res,rc,m,"ERROR. User is not lessee. name=" + name);
	}
	
	// Verify the lessor is authorized.
	if (UPDATE_USER != lessor) {
		return sendErrorResponse(res,rc,m,"ERROR. User " + UPDATE_USER + " is not lessee. Current lessee: " + lessor);
	}

    // Define the names for snapshots.
	var oldSnapshotName = MASTER_SNAPSHOT_NAME;
	rc['oldSnapshotName'] = oldSnapshotName;

	var renamedSnapshotName = 'old-' + tr.getLogTimestamp();
	rc['renamedSnapshotName'] = renamedSnapshotName;

	var newSnapshotName = MASTER_SNAPSHOT_NAME;
	rc['newSnapshotName'] = newSnapshotName;

	// Get the hypervisor for the VM
	var hypervisor = getHypervisor(name);
	tr.log(5,m,"hypervisor=" + hypervisor);
	if (!hypervisor) {
		return sendErrorResponse(res,rc,m,"ERROR. Could not find hypervisor for VM: " + name);
	}

	// Get miscellaneous information which may be required by the hypervisor.
	var blob = getBlob(name, lessor);

	tr.log(5,m,"Calling hypervisor.isRunning(" + name + ")");
	tr.log(5,m,"getName: " + hypervisor.getName());
	hypervisor.isRunning(name, blob, function(err, running) {
		var m = "isRunningCallback";
		if (err) {
			tr.log(5,m,err);
			return sendErrorResponse(res,rc,m,"ERROR getting VM status. " + name);
		}
		// Object value.
		if ('rc' in running) {
			tr.log(5,m,"Handling response object: " + util.inspect(running));
			if (0 != running.rc) {
				return sendErrorResponse(res,rc,m,"ERROR getting VM status. " + name);
			}
			if ('running' in running) {
				running = running.running;
			}
			else if ('active' in running) {
				running = running.active;
			}
			else {
				tr.log(5,m,"WARNING: Unrecognized object.");
			}
		}

		// boolean value.
		if (running) {
			return sendErrorResponse(res,rc,m,"ERROR: VM is running: " + name);
		}

		tr.log(5,m,"Calling hypervisor.renameSnapshot(" + name + ", " + oldSnapshotName + ", " + renamedSnapshotName + ")");
		tr.log(5,m,"getName: " + hypervisor.getName());
		hypervisor.renameSnapshot(name, oldSnapshotName, renamedSnapshotName, blob, function(err) {
			var m = "renameSnapshotCallback";
			if (err) {
				tr.log(5,m,err);
				return sendErrorResponse(res,rc,m,"ERROR renaming snapshot. vm name=" + name);
			}

			tr.log(5,m,"Calling hypervisor.takeSnapshot(" + name + ")");
			tr.log(5,m,"getName: " + hypervisor.getName());
			hypervisor.takeSnapshot(name, newSnapshotName, blob, function(err) {
				var m = "takeSnapshotCallback";
				if (err) {
					tr.log(5,m,err);
					return sendErrorResponse(res,rc,m,"ERROR taking snapshot. vame=" + name);
				}
				sendSuccessResponse(res,rc,m,"Updated snapshot. vmname=" + name + " renamedSnapshotName=" + renamedSnapshotName + " newSnapshotName=" + newSnapshotName);
				recordActivityHelper(req, lessor, name, "Updated snapshot.");
				tr.log(5,m,"Exit.");
			});
			tr.log(5,m,"Exit.");
		});
		tr.log(5,m,"Exit.");
	});
	tr.log(5,m,'Exit');
}


/**
 * Returns IP address for specified hostname.
 *
 * Example:
 * Request:  curl "http://localhost:7890/pool/getIP/dingHTC"
 * Response:  [{ "name": "dingHTC", "IP": "9.27.123.21" }]
 */
function getIP(req, res) {
	var m = "getIP";
	logClientRequest(req);
	tr.log(5,m,"Entry: Getting IP.");

	// Extract the hostname from the request.
	var name = req.params.name
	tr.log(5,m,"name=" + name);

	// Get the hypervisor for the VM
	// TODO:  How should we get the IP for a real machine???   Hack for today: use vlaunchhypervisor.
	var hypervisor = getHypervisor(name);
	tr.log(5,m,"hypervisor=" + hypervisor);
	if (!hypervisor) {
		return sendErrorResponse(res,rc,m,"ERROR. Could not find hypervisor for VM: " + name);
	}

	// Get miscellaneous information which may be required by the hypervisor.
	var blob = getBlob(name, null);

	// get IP from hypervisor
	hypervisor.getIP(name, blob, function(err,rspObj) {
		var ip = ((err || 0 != rspObj.rc) ? "" : rspObj.ip );
		return res.send([{ 'name': name, 'ip': ip }]);
	});
}

/**
 * Pings the specified specified hostname or IP.
 *
 * Example:
 * Request:  curl "http://localhost:7890/pool/canPing/btfs.raleigh.ibm.com"
 * Response:  [{ "hostname": "btfs.raleigh.ibm.com", "rc": 0, "msg": "blah blah" }] 
 */
function canPing(req, res) {
	var m = "canPing";
	logClientRequest(req);
	tr.log(5,m,"Entry: Pinging.");
	var rc = {};
	
	// Extract the hostname from the request.
	var hostname = req.params.hostname;
	tr.log(5,m,"hostname=" + hostname);
	rc['hostname'] = hostname;

	// Issue one ping request, timeout 2 seconds.
	var cmd = 'ping -c 1 -W 2 ' + hostname;

	console.log(m + ' Running: ' + cmd);

	proc.exec(cmd, function (err, stdout, stderr) {
		var m = 'pingCallback';
		if (!err && stdout && (0 < stdout.length) && (-1 != stdout.indexOf('bytes from'))) {
			sendSuccessResponse(res,rc,m,"Ok. Can ping " + hostname + ". stdout: " + stdout);
		}
		else {
			sendErrorResponse(res,rc,m,"ERROR. Can not ping " + hostname + ". err" + err);
		}
		tr.log(5,m,"Exit.");
	});
}

/**
 * Exits the script.
 */
function returnExit() {
	exit();
}

//-----------------------------------------
// The program starts here...
//-----------------------------------------
var m = "main";
tr.log(5,m,"Entry.");

// Read the server configuration file.
var filetext = fs.readFileSync(SERVER_CONFIG_FILENAME, 'utf8');
serverconfig = JSON.parse(filetext);

contextroot = serverconfig.contextroot;
if (contextroot == undefined) {
    tr.log(5,m,"Error. contextroot is undefined in server config file: " + SERVER_CONFIG_FILENAME);
    returnExit();
}

listenport = serverconfig.listenport;
if (listenport == undefined) {
    tr.log(5,m,"Error. listenport is undefined in server config file: " + SERVER_CONFIG_FILENAME);
    returnExit();
}

maxLeaseMs = serverconfig.maxLeaseMs;
if (maxLeaseMs == undefined) {
	tr.log(5,m,"Error. maxLeaseMs is undefined in server config file: " + SERVER_CONFIG_FILENAME);
	returnExit();
}

tr.log(5,m,"contextroot=" + contextroot + " listenport=" + listenport + " maxLeaseMs=" + maxLeaseMs);

// Read the devices file.
filetext = fs.readFileSync(DEVICES_FILENAME, 'utf8');
tr.log(5,m,"filetext: >>>" + filetext + "<<<");
devices = JSON.parse(filetext);
tr.log(5,m,"devices: " + util.inspect(devices));

// Read the leases file.
filetext = fs.readFileSync(LEASES_FILENAME, 'utf8');
tr.log(5,m,"filetext: >>>" + filetext + "<<<");
leases = JSON.parse(filetext);
tr.log(5,m,"leases: " + util.inspect(leases));

// Read the users file.
filetext = fs.readFileSync(USERS_FILENAME, 'utf8');
tr.log(5,m,"filetext: >>>" + filetext + "<<<");
users = JSON.parse(filetext);
tr.log(5,m,"users: " + util.inspect(users));

// Get access to the snapshot names.
tr.log(5,m,"Getting access to snapshot names. LOG_LEVEL=" + LOG_LEVEL + " LOG_FILENAME=" + LOG_FILENAME);
var snapshots = new Snapshots(LOG_LEVEL, LOG_FILENAME);  // 5=verbose  3=medium  0=errors only

// START - UNIT TEST
/*
tr.log(5,m,"Got access to snapshot names.");
tr.log(5,m,snapshots.toString());
var bozosnap = snapshots.getSnapshotName("bozo");
tr.log(5,m,"bozosnap=" + bozosnap);
var barneysnap = snapshots.getSnapshotName("barney");
tr.log(5,m,"barneysnap=" + barneysnap);

var src = snapshots.setSnapshotName("peter");
tr.log(5,m,"rc=" + src);
src = snapshots.setSnapshotName("peter","ps");
tr.log(5,m,"rc=" + src);
src = snapshots.setSnapshotName("peter","bozosnap");
tr.log(5,m,"rc=" + src);

petersnap = snapshots.getSnapshotName("peter");
tr.log(5,m,"petersnap=" + petersnap);
*/
// FINISH UNIT TEST




// Read the hypervisors file.
filetext = fs.readFileSync('hypervisors.json', 'utf8');
hypervisors = JSON.parse(filetext);

// Load each hypervisor object.
for (var i=0; i<hypervisors.length; i++) {
	var hypervisor = hypervisors[i];
	var hypervisorName = hypervisor.name;
	var className = hypervisor.classname;
	var blob = { "hypervisor": hypervisor };
	tr.log(5,m,"Handling hypervisor: " + hypervisorName + " classname: " + className);
	// Assimilate the module.
	var Class = require("./hypervisors/" + className + ".js");
	hypervisor.object = new Class(blob);
	tr.log(5,m,"Assimilated new hypervisor object: " + util.inspect(hypervisor.object));
	var hypervisorObject = hypervisor.object;
	tr.log(5,m,"hypervisorObject.getName()=" + hypervisorObject.getName());
}

// Create a tmp directory if nonexistent.
var tmpdir = "tmp";
if (!fs.existsSync(tmpdir)) {
	fs.mkdirSync(tmpdir);
}

// Query the timestamp of this file, tmca.js
var thisFilename = "tmca.js";
var thisFileStats = fs.statSync(thisFilename);
var thisFileMtime = thisFileStats.mtime;
tr.log(5,m,"Version: " + thisFileMtime);

// Create HTTP server.
var server = restify.createServer();
server.use(restify.bodyParser({ mapParams: false }));
tr.log(5,m,"Created HTTP server.");

// Associate HTTP GET commands to javascript functions.
server.get('/' + contextroot + '/', getHTML);
server.get('/' + contextroot + '/log/:numchars', getLog);
server.get('/' + contextroot + '/getAllDevices/:lessor', getAllDevices);
server.get('/' + contextroot + '/getDevicesByContentsOSBits/:contents/:os/:bits/:lessor', getDevicesByContentsOSBits);
server.get('/' + contextroot + '/getVMStatus/:name', getVMStatus);
server.get('/' + contextroot + '/getIP/:name', getIP);
server.get('/' + contextroot + '/canPing/:hostname', canPing);

// Associate HTTP POST commands to javascript functions for leasing.
server.post('/' + contextroot + '/leaseDeviceByContentsOSBits', leaseDeviceByContentsOSBits);
server.post('/' + contextroot + '/leaseDeviceByOS', leaseDeviceByOS);
server.post('/' + contextroot + '/leaseDeviceByName', leaseDeviceByName);
server.post('/' + contextroot + '/unleaseDeviceByName', unleaseDeviceByName);
//server.post('/' + contextroot + '/addDevice', addDevice);
//server.post('/' + contextroot + '/removeDevice', removeDevice);

// Associate HTTP POST commands to javascript functions for VM controls.
server.post('/' + contextroot + '/restoreVM', restoreVM);
server.post('/' + contextroot + '/startVM', startVM);
server.post('/' + contextroot + '/stopVM', stopVM);

// Associate HTTP POST commands to javascript functions for hybrid leasing and VM control commands.
server.post('/' + contextroot + '/stopUnleaseVM', stopUnleaseVM);
server.post('/' + contextroot + '/stopRestoreUnleaseVM', stopRestoreUnleaseVM);

// Associate HTTP POST commands to javascript functions for VM snapshots.
server.post('/' + contextroot + '/setSnapshotName', setSnapshotName);
server.post('/' + contextroot + '/renameSnapshot', renameSnapshot);
server.post('/' + contextroot + '/takeSnapshot', takeSnapshot);
server.post('/' + contextroot + '/updateSnapshot', updateSnapshot);

// For debug only
server.post('/' + contextroot + '/slowsrv', slowsrv);

// Start server and block here processing requests repeatedly.
tr.log(5,m,"Starting server listening on port " + listenport + "...");
server.listen(listenport, function() {
	tr.log(5,m,server.name + ' listening at ' + server.url);
});

// Monitor all leases for expiration.
monitorLeaseDuration();

// Watch for updated users file.
fs.watch( USERS_FILENAME, function(event,file) {
    var m = "userwatcher";
	tr.log(5,m,"Entry. event=" + util.inspect(event) + " file=" + util.inspect(file));

	if ("change" === event) {
		try {
			// Read the users file.
			var usertext = fs.readFileSync(USERS_FILENAME, 'utf8');
			var usersTmp = JSON.parse(usertext);
			users = usersTmp;
			console.log("Successfully assimilated new users object.");
		}
		catch (e) {
			console.log("Caught exception reading file " + USERS_FILENAME);
			console.log(e);
		}
		tr.log(5,m,"Exit. users: " + util.inspect(users));
	}
});

// Watch for updated devices file.
fs.watch( DEVICES_FILENAME, function(event,file) {
	var m = "deviceswatcher";
	tr.log(5,m,"Entry. event=" + util.inspect(event) + " file=" + util.inspect(file));

	if ("change" === event) {
		try {
			// Read the devices file.
			var devicestext = fs.readFileSync(DEVICES_FILENAME, 'utf8');
			var devicesTmp = JSON.parse(devicestext);
			devices = devicesTmp;
			tr.log(5,m,"Successfully assimilated new devices object.");
		}
		catch (e) {
			tr.log(5,m,"Caught exception reading file " + DEVICES_FILENAME);
			console.log(e);
		}
		tr.log(5,m,"Exit. devices: " + util.inspect(devices));
	}
});



tr.log(5,m,"Exit.");
