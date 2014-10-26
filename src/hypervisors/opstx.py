"""
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
"""
"""
    This script associates and deassociates floating IP addresses with VM instances.

    Prereqs:
        This script makes use of the python-novaclient library.
            https://pypi.python.org/pypi/python-novaclient/
            https://github.com/openstack/python-novaclient
        Install python-novaclient on your machine.  Example:
            apt-get install python-novaclient

    To invoke:
        python associate|deassociate <vmname>

    Returns rc=0 on success

    AD 2013-1106-1400
"""
import time
import os
import sys
from novaclient.v1_1 import client
from novaclient import utils
from novaclient.v1_1 import servers

# return codes.
RC_MISSING_ENV_VARS = 100
RC_INCORRECT_ARGS = 101
RC_UNRECOGNIZED_ACTION = 102
RC_NOVA_EXCEPTION = 103
RC_SERVER_NOT_FOUND = 104
RC_IP_NOT_AVAILABLE = 105
RC_IP_NOT_ASSOCIATED = 106
RC_IP_ALREADY_ASSOCIATED = 107
RC_SERVER_NOT_ACTIVE = 108
RC_SERVER_ERROR = 109

#-----------------------------------------------------------------------
def getSopTimestamp():
    """Returns the current system timestamp in a nice internationally-generic format."""
    return time.strftime('[%Y-%m%d-%H%M-%S00]')


def sop(methodname,message):
    """Prints the specified method name and message with a nicely formatted timestamp.
    (sop is an acronym for System.out.println() in java)"""
    timestamp = getSopTimestamp()
    print "%sopstx.py/%s: %s" % (timestamp, methodname, message)


#-----------------------------------------------------------------------
def getAvailableFloatingIP(cs):
    """Gets a floating IP address from the pool.
       Returns FloatingIP object or None."""
    m = "getAvailableFloatingIP"
    sop(m,"Entry.")

    floating_ip_list = cs.floating_ips.list()
    sop(m,"floating_ip_list: %s" % ( repr(floating_ip_list) ))
    for floating_ip in floating_ip_list:
        sop(m,"floating_ip: %s" % ( repr(floating_ip) ))
        if None == floating_ip.instance_id:
            sop(m,"Exit. Returning available floating ip.")
            return floating_ip

    sop(m,"Exit. Did not find available floating_ip. Returning None")
    return None


def getAssociatedFloatingIP(cs, server):
    """Gets a floating IP address which has been associated with a VM instance.
       Returns FloatingIP object or None."""
    m = "getAssociatedFloatingIP"
    sop(m,"Entry.")

    floating_ip_list = cs.floating_ips.list()
    sop(m,"floating_ip_list: %s" % ( repr(floating_ip_list) ))
    for floating_ip in floating_ip_list:
        sop(m,"floating_ip: %s" % ( repr(floating_ip) ))
        if server.id == floating_ip.instance_id:
            sop(m,"Exit. Found matching server instance ID.")
            return floating_ip

    sop(m,"Exit. Did not find matching floating_ip. Returning None")
    return None


def deallocateAllAvailableFloatingIPs(cs):
    """Deallocates all floating IPs (not associated with a VM) to the global public pool."""
    m = "deallocateAllAvailableFloatingIPs"
    sop(m,"Entry.")

    floating_ip_list = cs.floating_ips.list()
    sop(m,"floating_ip_list: %s" % ( repr(floating_ip_list) ))
    for floating_ip in floating_ip_list:
        sop(m,"floating_ip: %s" % ( repr(floating_ip) ))
        if None == floating_ip.instance_id:
            sop(m,"Deallocating available floating ip: %s" % (repr(floating_ip.ip)))
            cs.floating_ips.delete(floating_ip.id)

    sop(m,"Exit.")
    return None


def allocateFloatingIP(cs, poolname):
    """Allocates one floating IP from the specified pool, if available."""
    m = "allocateFloatingIP"
    sop(m,"Entry. poolname=" + poolname)

    cs.floating_ips.create(pool=poolname)

    sop(m,"Exit.")
    return None


def waitForServerActive(cs, vmname):
    """Waits until timeout for the specified server to be in 'active' state.
      Returns immediately on status 'active' or 'error'.
      Returns the server object upon exit."""
    m = "waitForServerActive"
    sop(m,"Entry. vmname=" + vmname)
    server = None

    # Initial design:  24 attempts, 7 seconds each, yields 2 minutes, 48 seconds.
    # Andy witnessed one launch take 2+ mins to go from state booting to active.
    numRetries = 24  
    while numRetries > 0:
        numRetries = numRetries - 1
        # important: get a fresh view of server status on every retry.
        server = utils.find_resource(cs.servers, vmname)
        if None == server:
            sop(m,"ERROR: Server not found: " + vmname)
            sys.exit(RC_SERVER_NOT_FOUND)
        status = server.status.lower()
        if "active" == status or "error" == status:
            sop(m,"Exit. status=" + status)
            return server
        sop(m,"Sleeping briefly. status=" + status + " numRetries=%i" % (numRetries))
        time.sleep(7)

    sop(m,"Exit. Timeout expired. status=" + status)
    return server

#-----------------------------------------------------------------------
def associate(cs,vmname):
    """Gets a floating IP address from the pool and associates it with the specified VM."""
    m = "associate"
    sop(m,"Entry. vmname=" + vmname)

    server = waitForServerActive(cs, vmname)
    if None == server or "active" != server.status.lower():
        sop(m,"ERROR. Server is not active: " + vmname)
        sys.exit(RC_SERVER_NOT_ACTIVE)

    floating_ip = getAssociatedFloatingIP(cs, server)
    if None != floating_ip:
        sop(m,"ERROR: A floating IP is already associated with server: " + vmname)
        sys.exit(RC_IP_ALREADY_ASSOCIATED)

    floating_ip = getAvailableFloatingIP(cs)
    if None == floating_ip:
        sop(m,"A floating IP is not initially available. Trying to allocate an IP...")
        allocateFloatingIP(cs, OS_IP_POOL_NAME)
        floating_ip = getAvailableFloatingIP(cs)
        if None == floating_ip:
            sop(m,"ERROR: A floating IP is not available after allocate for server: " + vmname)
            sys.exit(RC_IP_NOT_AVAILABLE)

    sop(m,"Adding floating_ip %s to server %s" % (repr(floating_ip.ip), repr(server)))
    server.add_floating_ip(floating_ip.ip)

    sop(m,"Exit.")


def deassociate(cs,vmname):
    """Removes a floating IP address from the specified VM."""
    m = "deassociate"
    sop(m,"Entry. vmname=" + vmname)

    server = utils.find_resource(cs.servers, vmname)
    if None == server:
        sop(m,"ERROR: Server not found: " + vmname)
        sys.exit(RC_SERVER_NOT_FOUND)

    floating_ip = getAssociatedFloatingIP(cs, server)
    if None == floating_ip:
        sop(m,"ERROR: A floating IP was not associated with server: " + vmname)
        sys.exit(RC_IP_NOT_ASSOCIATED)

    sop(m,"Removing floating_ip %s from server %s" % (repr(floating_ip.ip), repr(server)))
    server.remove_floating_ip(floating_ip.ip)

    sop(m,"Deallocating all available floating_IPs.")
    deallocateAllAvailableFloatingIPs(cs)
    
    sop(m,"Exit. Success.")


def displayassociated(cs,vmname):
    """Displays floating IP address associated with specified VM.
       Returns the IP in a string in the form of a json object."""
    m = "displayassociated"
    sop(m,"Entry. vmname=" + vmname)

    server = utils.find_resource(cs.servers, vmname)
    if None == server:
        sop(m,"ERROR: Server not found: " + vmname)
        sys.exit(RC_SERVER_NOT_FOUND)

    floating_ip = getAssociatedFloatingIP(cs, server)
    if None == floating_ip:
        sop(m,"ERROR: A floating IP was not associated with server: " + vmname)
        sys.exit(RC_IP_NOT_ASSOCIATED)

    sop(m,"Exit. Success. Returning floating_ip: " + floating_ip.ip)

    print('{ "rc": 0, "ip": "%s", "msg": "OPSTX7832I: Found floating IP %s for VM %s" }' % (floating_ip.ip, floating_ip.ip, vmname))


#-----------------------------------------------------------------------
m = "main"


# Hard-coded constants
OS_IP_POOL_NAME = "vlan_690_network"


# Read environment variables
os_auth_url = os.getenv("OS_AUTH_URL")
os_tenant_id = os.getenv("OS_TENANT_ID")
os_tenant_name = os.getenv("OS_TENANT_NAME")
os_username = os.getenv("OS_USERNAME")
os_password = os.getenv("OS_PASSWORD")


# check environment variables
if None == os_auth_url or None == os_tenant_id or None == os_tenant_name or None == os_username or None == os_password:
    sop(m,"ERROR: Please set all environment variables: OS_AUTH_URL, OS_TENANT_ID, OS_TENANT_NAME, OS_USERNAME, OS_PASSWORD")
    sys.exit(RC_MISSING_ENV_VARS)


# show environment variables
sop(m,"os_auth_url=" + os_auth_url);
sop(m,"os_tenant_id=" + os_tenant_id);
sop(m,"os_tenant_name=" + os_tenant_name);
sop(m,"os_username=" + os_username);
sop(m,"os_password=XXXXXXXXXX")


# parse args
if 3 != len(sys.argv):
    sop(m,"ERROR: Please specify args: associate|displayassociated|deassociate <vmname>.")
    sys.exit(RC_INCORRECT_ARGS)
arg_action = sys.argv[1]
arg_vmname = sys.argv[2]


# show args
sop(m,"arg_action=" + arg_action)
sop(m,"arg_vmname=" + arg_vmname)


try:
    # create the OpenStack ComputeShell from the nova library
    cs = client.Client(os_username, os_password, os_tenant_name, os_auth_url, service_type="compute")

    # go
    if "associate" == arg_action:
        associate(cs, arg_vmname)
    elif "displayassociated" == arg_action:
        displayassociated(cs, arg_vmname)
    elif "deassociate" == arg_action:
        deassociate(cs, arg_vmname)

    # for debug only...
    elif "deallocate" == arg_action:
        deallocateAllAvailableFloatingIPs(cs)
    elif "allocate" == arg_action:
        allocateFloatingIP(cs, OS_IP_POOL_NAME)
    else:
        sop(m,"ERROR: Please specify args: python opstx.py associate|deassociate <vmname>")
        sys.exit(RC_UNRECOGNIZED_ACTION)

except Exception as e:
    sop(m,"ERROR: Caught exception from python-novaclient:")
    sop(m,e)
    sys.exit(RC_NOVA_EXCEPTION)


sop(m,"Exit. Success.")
