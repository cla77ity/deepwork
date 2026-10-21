// System layer for the current OS. Both implementations expose the same functions:
// dndOn/dndOff, writeHosts/hostsHasBlock/buildHosts, listProcesses/watchProcesses, appInfo, openBrave.
module.exports = process.platform === 'darwin' ? require('./sys-mac') : require('./sys-win');
