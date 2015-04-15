"""
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
        python  opstx.py  associate|deassociate  <vmname>

    Returns rc=0 on success

    AD 2013-1106-1400
"""
import time
import os
import sys
from novaclient.v1_1 import client
from novaclient import utils
from novaclient.v1_1 import servers
from random import choice

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


def getRandomAvailableFloatingIP(cs):
    """Gets a random floating IP address from the pool.
       Returns FloatingIP object or None."""
    m = "getRandomAvailableFloatingIP"
    sop(m,"Entry.")

    available_ip_list = []
    floating_ip_list = cs.floating_ips.list()
    sop(m,"floating_ip_list: %s" % ( repr(floating_ip_list) ))
    for floating_ip in floating_ip_list:
        sop(m,"floating_ip: %s" % ( repr(floating_ip) ))
        if None == floating_ip.instance_id:
            available_ip_list.append(floating_ip)

    if 0 == len(available_ip_list):
        sop(m,"Exit. Did not find available floating_ip. Returning None")
        return None
    else:
        random_ip = choice(available_ip_list)
        sop(m,"Exit. Returning random available floating ip.")
        return random_ip


def getAssociatedFloatingIP(cs, server, numRetries):
    """Gets a floating IP address which has been associated with a VM instance.
       Returns FloatingIP object or None."""
    m = "getAssociatedFloatingIP"
    sop(m,"Entry. server=%s numRetries=%i" % ( repr(server), numRetries ))

    numExceptions = 0
    while numRetries > 0 and numExceptions < 3:
        try:
            floating_ip_list = cs.floating_ips.list()
            sop(m,"floating_ip_list: %s" % ( repr(floating_ip_list) ))
            for floating_ip in floating_ip_list:
                sop(m,"floating_ip: %s" % ( repr(floating_ip) ))
                if server.id == floating_ip.instance_id:
                    sop(m,"Exit. Found matching server instance ID. server=%s  Returning ip=%s" % ( repr(server), repr(floating_ip) ))
                    return floating_ip
            # decrement retry count only when there are no exceptions.
            numRetries = numRetries - 1
        except Exception as e:
            sop(m,"ERROR: Caught exception from python-novaclient for server=" + repr(server) + ":")
            sop(m,e)
            numExceptions = numExceptions + 1

        if numRetries > 0 and numExceptions < 3:   # Ugly construction! duplicate code. Fix this.
            sop(m,"Sleeping briefly. server=" + repr(server) + " numRetries=%i numExceptions=%i" % (numRetries, numExceptions))
            time.sleep(3)

    sop(m,"Exit. Did not find matching floating_ip. Retries exhausted. Returning None. server=%s" % ( repr(server) ))
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

    # Try for 100 attempts, 3 seconds each, yields 5 minutes.
    # (Andy witnessed one launch take 4 mins to go from state booting to active.)
    numRetries = 100
    while numRetries > 0:
        numRetries = numRetries - 1
        try:
            # important: get a fresh view of server status on every retry.
            server = utils.find_resource(cs.servers, vmname)
            if None == server:
                sop(m,"ERROR: Server not found: " + vmname)
                sys.exit(RC_SERVER_NOT_FOUND)
            status = server.status.lower()
            if "active" == status or "error" == status:
                sop(m,"Exit. server=" + vmname + " status=" + status)
                return server
        except Exception as e:
            sop(m,"ERROR: Caught exception from python-novaclient for server=" + vmname + ":")
            sop(m,e)
        sop(m,"Sleeping briefly. server=" + vmname + " status=" + status + " numRetries=%i" % (numRetries))
        time.sleep(3)

    sop(m,"Exit. Timeout expired. server=" + vmname + " status=" + status)
    return server

#-----------------------------------------------------------------------
def isactive(cs,vmname):
    """Indicates whether the specified VM is active. Returns rc=0 when active."""
    m = "isactive"
    sop(m,"Entry. vmname=" + vmname)

    try:
        server = utils.find_resource(cs.servers, vmname)
        if None == server:
            sop(m,"ERROR: Server not found: " + vmname + " Returning RC_SERVER_NOT_FOUND")
            sys.exit(RC_SERVER_NOT_FOUND)
        status = server.status.lower()
        if "error" == status:
            sop(m,"Exit. status=" + status + " vmname=" + vmname + " Returning RC_SERVER_ERROR")
            sys.exit(RC_SERVER_ERROR)
        if "active" != status:
            sop(m,"Exit. status=" + status + " vmname=" + vmname + " Returning RC_SERVER_NOT_ACTIVE")
            sys.exit(RC_SERVER_NOT_ACTIVE)
        sop(m,"Exit. status=" + status + " vmname=" + vmname + " Returning rc=0")
        sys.exit(0)
    except Exception as e:
        sop(m,"ERROR: Caught exception from python-novaclient for server " + vmname + ":")
        sop(m,e)
        sop(m,"Returning RC_SERVER_NOT_FOUND")
        sys.exit(RC_SERVER_NOT_FOUND)

def associate(cs,vmname):
    """Gets a floating IP address from the pool and associates it with the specified VM."""
    m = "associate"
    sop(m,"Entry. vmname=" + vmname)

    server = waitForServerActive(cs, vmname)
    if None == server or "active" != server.status.lower():
        sop(m,"ERROR. Server is not active: " + vmname)
        sys.exit(RC_SERVER_NOT_ACTIVE)

    floating_ip = getAssociatedFloatingIP(cs, server, 1)
    if None != floating_ip:
        sop(m,"ERROR: A floating IP is already associated with server: " + vmname)
        sys.exit(RC_IP_ALREADY_ASSOCIATED)

    numRetries = 7
    while numRetries > 0:
        try:
            numRetries = numRetries - 1
            floating_ip = getRandomAvailableFloatingIP(cs)
            if None == floating_ip:
                sop(m,"A floating IP is not initially available. Trying to allocate an IP...")
                allocateFloatingIP(cs, OS_IP_POOL_NAME)
                floating_ip = getRandomAvailableFloatingIP(cs)
                if None == floating_ip:
                    sop(m,"ERROR: A floating IP is not available after allocate for server: " + vmname)
                    sys.exit(RC_IP_NOT_AVAILABLE)

            sop(m,"Adding floating_ip %s to server %s" % (repr(floating_ip.ip), repr(server)))
            server.add_floating_ip(floating_ip.ip)

            sop(m,"Sleeping briefly before confirming.")
            time.sleep(2)

            actual_floating_ip = getAssociatedFloatingIP(cs, server, 7)
            if None != actual_floating_ip:
                if repr(floating_ip.ip) == repr(actual_floating_ip.ip):
                    sop(m,"Confirmed requested floating IP %s is associated with server %s." % (repr(actual_floating_ip.ip), vmname))
                else:
                    sop(m,"WARNING: Unexpected floating IP is associated with server %s. expected=%s actual=%s" % (vmname, repr(floating_ip.ip), repr(actual_floating_ip.ip)))
                break

        except Exception as e:
            sop(m,"ERROR: Caught exception from python-novaclient for server " + vmname + ":")
            sop(m,e)

        sop(m,"WARNING: A floating IP is not associated with server %s. Sleeping before retry. numRetries=%i" % (vmname, numRetries))
        # Slowly increase sleep time.
        time.sleep(1 + (7 - numRetries))

    if None == actual_floating_ip:
        sop(m,"ERROR: Could not confirm a floating IP is associated with server: " + vmname + ". All retries exhausted.")
        sys.exit(RC_IP_NOT_ASSOCIATED)

    sop(m,"Exit.")


def deassociate(cs,vmname):
    """Removes a floating IP address from the specified VM."""
    m = "deassociate"


    # Note changed behavior:  Do nothing. Let OpenStack clean up the Floating IPs.	
    sop(m,"Entry/exit. Doing nothing. Returning success.")
    return None


    sop(m,"Entry. vmname=" + vmname)

    server = utils.find_resource(cs.servers, vmname)
    if None == server:
        sop(m,"ERROR: Server not found: " + vmname)
        sys.exit(RC_SERVER_NOT_FOUND)

    floating_ip = getAssociatedFloatingIP(cs, server, 1)
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

    floating_ip = getAssociatedFloatingIP(cs, server, 1)
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
supported_args = "associate|displayassociated|deassociate|isactive"
if 3 != len(sys.argv):
    sop(m,"ERROR: Please specify args: " + supported_args + " <vmname>.")
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
    elif "isactive" == arg_action:
        isactive(cs, arg_vmname)

    # for debug only...
    elif "deallocate" == arg_action:
        deallocateAllAvailableFloatingIPs(cs)
    elif "allocate" == arg_action:
        allocateFloatingIP(cs, OS_IP_POOL_NAME)
    else:
        sop(m,"ERROR: Please specify args: " + supported_args + " <vmname>.")
        sys.exit(RC_UNRECOGNIZED_ACTION)

except Exception as e:
    sop(m,"ERROR: Caught exception from python-novaclient:")
    sop(m,e)
    sys.exit(RC_NOVA_EXCEPTION)


sop(m,"Exit. Success.")
