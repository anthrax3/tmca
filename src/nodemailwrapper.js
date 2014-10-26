/**
Copyright IBM Corp. 2013

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
	This module provides a simple interface to the nodemailer library.

	To use this module, simply call method sendEmail with recipients and contents.

	AD 2013-0319-1457
*/
var nodemailer = require('nodemailer');
var fs = require('fs');
var os = require("os");

var NodeMailWrapper = function() {

	/**
	 * Helper method sends an email to the specified recipients.
	 * More info at:  https://github.com/andris9/Nodemailer
	 */
	this.sendEmail = function(dstUserList, subject, message, cb) {

		// Convert recipient list to string.  (todo: use join(', ')? )
		for (var i=0; i<dstUserList.length; i++) {
			if (0 == i) {
				var dstUserString = dstUserList[i];
			}
			else {
				dstUserString = dstUserString + ', ' + dstUserList[i];
			}
		}
		console.log('dstUserString: ' + dstUserString);

		// Create transport method for the sender.
		var smptSrv = "relay.uk.ibm.com";
		var smtpTransport = nodemailer.createTransport("SMTP", {
		    host: smptSrv
		});

		// Get local hostname on which this TMCA process is running.
		var tmcahostname = os.hostname();

		// Define the sender email address.  Example: tmca.ralvm0@us.ibm.com
		var srcUser = "tmca." + tmcahostname + "@us.ibm.com";

		// Create message to be sent.
		var mailOptions = {
		    from: srcUser,
		    to: dstUserString,
		    subject: subject,
		    text: message
		};

		// Send it.
		smtpTransport.sendMail(mailOptions, function(err, response) {
			console.log('Callback from transport.sendMail(): ', err, response);
		    if (err) return cb(new Error(err));
			var results = response.message;
		    smtpTransport.close(); 
			console.log('exit. returning results: ' + results);
			return cb(null, results);
		});
	}
};


module.exports = NodeMailWrapper;

