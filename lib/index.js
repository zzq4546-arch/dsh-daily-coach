/* dsh-daily-coach — host half.
 *
 * Empty on purpose: mounting a fiber for this package is what lets the client
 * bundle (client.js) reach the page. All behaviour lives in the browser half.
 */

/** Stable Cordis plugin name; matches cordis.patch.yml's roster id. */
const name = "dsh-daily-coach";

/** No host-side services are required. */
function apply() {}

export { apply, name };
