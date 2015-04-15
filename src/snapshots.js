/**
Copyright IBM Corp. 2015

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

    This module stores and retreives information about device snapshots.

*/
var Tr = require('./tr.js');
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
var Snapshots = function(loglevelin, logfilenamein) {
    var loglevel = loglevelin;
    var logfilename = logfilenamein;
	var classname = "snapshots.js";
    var SNAPSHOTS_FILENAME = "snapshots.json";
	var DEFAULT_SNAPSHOT_NAME = "master";
	var m = "main";

	/**
	 * Init: Open a log file
	 */
	var tr = new Tr(classname, loglevel, logfilename);  // 5=verbose  3=medium  0=errors only

	/**
	 * Init: Read the snapshots file.
	 */
	var filetext = fs.readFileSync(SNAPSHOTS_FILENAME, 'utf8');
	tr.log(5,m,"filetext: >>>" + filetext + "<<<");
	var snapshots = JSON.parse(filetext);
	tr.log(5,m,"snapshots: " + util.inspect(snapshots));


    /**
	 * API: Trivial method, good for debug.
	 */
	this.toString = function() {
		var m = "toString";
		tr.log(5,m,"Entry. Returning important information...");

		return classname + ": snapshotsfilename=" + SNAPSHOTS_FILENAME + " snapshots.length=" + snapshots.length;
	}


	/**
	 * Private: Returns the snapshot object for the specified device.
	 * Note:  If not found, creates a new element in the table with default snapshot name.
	 */
	var getSnapshot = function(devicename) {
		var m = "getSnapshot";
		//tr.log(5,m,"Entry. devicename=" + devicename + " snapshots.length=" + snapshots.length);

		for (var i=0; i<snapshots.length; i++) {
			var snapshot = snapshots[i];
			var dev = snapshot.devicename;
			var snap = snapshot.snapshotname;
			//tr.log(5,m,"snapshot[" + i + "]: dev=" + dev + " snap=" + snap);

			if (devicename == dev) {
				//tr.log(5,m,"Exit. Returning snapshot " + snap + " for device " + devicename);
				return snapshot;
			}
		}

		// Not found. Create new snapshot.
		tr.log(5,m,"Device " + devicename + " not found. Creating new entry.");
		var snapshot = {"devicename": devicename, "snapshotname": DEFAULT_SNAPSHOT_NAME};
		snapshots.push(snapshot);

		// Save to file.
		fs.writeFileSync(SNAPSHOTS_FILENAME, JSON.stringify(snapshots));

		tr.log(5,m,"Exit. Returning snapshot " + DEFAULT_SNAPSHOT_NAME + " for device " + devicename);
		return snapshot;
	}



	/**
	 * API: Returns the snapshot name for the specified device.
	 * Note:  If not found, creates a new element in the table with default snapshot name.
	 */
	this.getSnapshotName = function(devicename) {
		var m = "getSnapshotName";
		//tr.log(5,m,"Entry. devicename=" + devicename + " snapshots.length=" + snapshots.length);

		var snapshot = getSnapshot(devicename);
		//tr.log(5,m,"Exit. Returning snapshotname " + snapshot.snapshotname + " for device " + devicename);
		return snapshot.snapshotname;
	}



	/**
	 * API: Writes the snapshot name for the specified device.
	 * Note:  If not found, creates a new element in the table with the specified snapshot name.
	 * Returns rc=0 on success.
	 */
	this.setSnapshotName = function(devicename,snapshotname) {
		var m = "setSnapshotName";
		tr.log(5,m,"Entry. devicename=" + devicename + " snapshotname=" + snapshotname);

		if (undefined == snapshotname) {
			tr.log(0,m,"Exit. Error. Snapshotname is undefined. dev=" + devicename);
			return -9;
		}
		if (3 > snapshotname.length) {
			tr.log(0,m,"Exit. Probable error. Snapshotname is too short: " + snapshotname + " dev=" + devicename);
			return -9;
		}

		var snapshot = getSnapshot(devicename);
		var oldsnapname = snapshot.snapshotname;
		snapshot.snapshotname = snapshotname;
		snapshot.timestamp = (new Date()).getTime();

		// Save to file.
		fs.writeFileSync(SNAPSHOTS_FILENAME, JSON.stringify(snapshots));

		tr.log(5,m,"Exit. Saved to file. dev=" + devicename + " old=" + oldsnapname + " new=" + snapshotname);
		return 0;
	}



	/**
	 * API: Returns the snapshot name for the specified device.
	 * Note:  If not found, creates a new element in the table with default name.
	 */
/*	this.getSnapshotName = function(devicename) {
		var m = "getSnapshotName";
		tr.log(5,m,"Entry. devicename=" + devicename + " snapshots.length=" + snapshots.length);

		for (var i=0; i<snapshots.length; i++) {
			var snapshot = snapshots[i];
			var dev = snapshot.devicename;
			var snap = snapshot.snapshotname;
			tr.log(5,m,"snapshot[" + i + "]: dev=" + dev + " snap=" + snap);

			if (devicename == dev) {
				tr.log(5,m,"Exit. Returning snapshot " + snap + " for device " + devicename);
				return snap;
			}
		}

		// Not found. Create new snapshot.
		tr.log(5,m,"Device " + devicename + " not found. Creating new entry.");
		var snapshot = {"devicename": devicename, "snapshotname": DEFAULT_SNAPSHOT_NAME};
		snapshots.push(snapshot);

		// Save to file.
		fs.writeFileSync(SNAPSHOTS_FILENAME, JSON.stringify(snapshots));

		tr.log(5,m,"Exit. Returning snapshot " + DEFAULT_SNAPSHOT_NAME + " for device " + devicename);
		return DEFAULT_SNAPSHOT_NAME;
	}
*/


};

module.exports = Snapshots;
