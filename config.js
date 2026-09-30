// Leave empty when the customer site and API share a host. Set to the deployed API origin for GitHub Pages.
window.MB_API_BASE = '';
// Live Server is static, so send its API requests to the local Express service.
// Render keeps the default same-origin API base.
const isVsCodeLiveServer = window.location.port === '5500';
window.MB_API_BASE = isVsCodeLiveServer
	? `${window.location.protocol}//${window.location.hostname}:3011`
	: '';
