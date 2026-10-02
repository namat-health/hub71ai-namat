/**
 * Deterministic presentation only: no clinical inference, persistence or network.
 * Source: Namat asset library revision 2, with clinic and scenery added 2026-10-01.
 * Responsive URLs stay literal so the start-site packager discovers each file.
 *
 * @typedef {{id:string,cast:string|null,scene:string,src:string,srcSet:string,width:number,height:number,alt:string,fit:'contain'|'cover',kind:'person'|'environment'|'route'}} JourneyVisual
 */

/** @type {Readonly<Record<string, Readonly<JourneyVisual>>>} */
export const JOURNEY_VISUALS = Object.freeze({
  "CLINIC01": Object.freeze({"id":"CLINIC01","cast":null,"scene":"welcome","src":"/assets/journey/clinic-welcome-960.webp","srcSet":"/assets/journey/clinic-welcome-480.webp 480w, /assets/journey/clinic-welcome-960.webp 960w, /assets/journey/clinic-welcome-1920.webp 1920w","width":960,"height":540,"alt":"The Namat clinic reception concept.","fit":"cover","kind":"environment"}),
  "ENV01": Object.freeze({"id":"ENV01","cast":null,"scene":"welcome","src":"/assets/journey/env01-800.webp","srcSet":"/assets/journey/env01-480.webp 480w, /assets/journey/env01-800.webp 800w, /assets/journey/env01-1200.webp 1200w","width":800,"height":1071,"alt":"A bright room with natural light.","fit":"cover","kind":"environment"}),
  "ENV02": Object.freeze({"id":"ENV02","cast":null,"scene":"neutral","src":"/assets/journey/env02-800.webp","srcSet":"/assets/journey/env02-480.webp 480w, /assets/journey/env02-800.webp 800w, /assets/journey/env02-1200.webp 1200w","width":800,"height":1071,"alt":"A quiet shoreline.","fit":"cover","kind":"environment"}),
  "F01-01": Object.freeze({"id":"F01-01","cast":"F01","scene":"recognition","src":"/assets/journey/f01-01-800.webp","srcSet":"/assets/journey/f01-01-480.webp 480w, /assets/journey/f01-01-800.webp 800w, /assets/journey/f01-01-1200.webp 1200w","width":800,"height":1071,"alt":"An adult at home beside a window.","fit":"contain","kind":"person"}),
  "F01-02": Object.freeze({"id":"F01-02","cast":"F01","scene":"priorities","src":"/assets/journey/f01-02-800.webp","srcSet":"/assets/journey/f01-02-480.webp 480w, /assets/journey/f01-02-800.webp 800w, /assets/journey/f01-02-1200.webp 1200w","width":800,"height":1071,"alt":"An adult at home with a notebook.","fit":"contain","kind":"person"}),
  "F01-03": Object.freeze({"id":"F01-03","cast":"F01","scene":"movement","src":"/assets/journey/f01-03-800.webp","srcSet":"/assets/journey/f01-03-480.webp 480w, /assets/journey/f01-03-800.webp 800w, /assets/journey/f01-03-1200.webp 1086w","width":800,"height":1067,"alt":"An adult enjoying an everyday activity.","fit":"contain","kind":"person"}),
  "F01-04": Object.freeze({"id":"F01-04","cast":"F01","scene":"everyday-routine","src":"/assets/journey/f01-04-800.webp","srcSet":"/assets/journey/f01-04-480.webp 480w, /assets/journey/f01-04-800.webp 800w, /assets/journey/f01-04-1200.webp 1200w","width":800,"height":1071,"alt":"An adult setting out a simple meal at home.","fit":"contain","kind":"person"}),
  "F01-05": Object.freeze({"id":"F01-05","cast":"F01","scene":"review","src":"/assets/journey/f01-05-800.webp","srcSet":"/assets/journey/f01-05-480.webp 480w, /assets/journey/f01-05-800.webp 800w, /assets/journey/f01-05-1200.webp 1200w","width":800,"height":1071,"alt":"An adult organising documents at home.","fit":"contain","kind":"person"}),
  "F02-01": Object.freeze({"id":"F02-01","cast":"F02","scene":"recognition","src":"/assets/journey/f02-01-800.webp","srcSet":"/assets/journey/f02-01-480.webp 480w, /assets/journey/f02-01-800.webp 800w, /assets/journey/f02-01-1200.webp 1200w","width":800,"height":1071,"alt":"An adult at home beside a window.","fit":"contain","kind":"person"}),
  "F02-02": Object.freeze({"id":"F02-02","cast":"F02","scene":"priorities","src":"/assets/journey/f02-02-800.webp","srcSet":"/assets/journey/f02-02-480.webp 480w, /assets/journey/f02-02-800.webp 800w, /assets/journey/f02-02-1200.webp 1200w","width":800,"height":1071,"alt":"An adult at home with a notebook.","fit":"contain","kind":"person"}),
  "F02-03": Object.freeze({"id":"F02-03","cast":"F02","scene":"movement","src":"/assets/journey/f02-03-800.webp","srcSet":"/assets/journey/f02-03-480.webp 480w, /assets/journey/f02-03-800.webp 800w, /assets/journey/f02-03-1200.webp 1086w","width":800,"height":1067,"alt":"An adult enjoying an everyday activity.","fit":"contain","kind":"person"}),
  "F02-04": Object.freeze({"id":"F02-04","cast":"F02","scene":"everyday-routine","src":"/assets/journey/f02-04-800.webp","srcSet":"/assets/journey/f02-04-480.webp 480w, /assets/journey/f02-04-800.webp 800w, /assets/journey/f02-04-1200.webp 1200w","width":800,"height":1071,"alt":"An adult setting out a simple meal at home.","fit":"contain","kind":"person"}),
  "F02-05": Object.freeze({"id":"F02-05","cast":"F02","scene":"review","src":"/assets/journey/f02-05-800.webp","srcSet":"/assets/journey/f02-05-480.webp 480w, /assets/journey/f02-05-800.webp 800w, /assets/journey/f02-05-1200.webp 1200w","width":800,"height":1071,"alt":"An adult organising documents at home.","fit":"contain","kind":"person"}),
  "F03-01": Object.freeze({"id":"F03-01","cast":"F03","scene":"recognition","src":"/assets/journey/f03-01-800.webp","srcSet":"/assets/journey/f03-01-480.webp 480w, /assets/journey/f03-01-800.webp 800w, /assets/journey/f03-01-1200.webp 1086w","width":800,"height":1067,"alt":"An adult at home beside a window.","fit":"contain","kind":"person"}),
  "F03-02": Object.freeze({"id":"F03-02","cast":"F03","scene":"priorities","src":"/assets/journey/f03-02-800.webp","srcSet":"/assets/journey/f03-02-480.webp 480w, /assets/journey/f03-02-800.webp 800w, /assets/journey/f03-02-1200.webp 1086w","width":800,"height":1067,"alt":"An adult at home with a notebook.","fit":"contain","kind":"person"}),
  "F03-03": Object.freeze({"id":"F03-03","cast":"F03","scene":"movement","src":"/assets/journey/f03-03-800.webp","srcSet":"/assets/journey/f03-03-480.webp 480w, /assets/journey/f03-03-800.webp 800w, /assets/journey/f03-03-1200.webp 1086w","width":800,"height":1067,"alt":"An adult enjoying an everyday activity.","fit":"contain","kind":"person"}),
  "F03-04": Object.freeze({"id":"F03-04","cast":"F03","scene":"everyday-routine","src":"/assets/journey/f03-04-800.webp","srcSet":"/assets/journey/f03-04-480.webp 480w, /assets/journey/f03-04-800.webp 800w, /assets/journey/f03-04-1200.webp 1086w","width":800,"height":1067,"alt":"An adult setting out a simple meal at home.","fit":"contain","kind":"person"}),
  "F03-05": Object.freeze({"id":"F03-05","cast":"F03","scene":"review","src":"/assets/journey/f03-05-800.webp","srcSet":"/assets/journey/f03-05-480.webp 480w, /assets/journey/f03-05-800.webp 800w, /assets/journey/f03-05-1200.webp 1086w","width":800,"height":1067,"alt":"An adult organising documents at home.","fit":"contain","kind":"person"}),
  "F04-01": Object.freeze({"id":"F04-01","cast":"F04","scene":"recognition","src":"/assets/journey/f04-01-800.webp","srcSet":"/assets/journey/f04-01-480.webp 480w, /assets/journey/f04-01-800.webp 800w, /assets/journey/f04-01-1200.webp 1086w","width":800,"height":1067,"alt":"An adult at home beside a window.","fit":"contain","kind":"person"}),
  "F04-02": Object.freeze({"id":"F04-02","cast":"F04","scene":"priorities","src":"/assets/journey/f04-02-800.webp","srcSet":"/assets/journey/f04-02-480.webp 480w, /assets/journey/f04-02-800.webp 800w, /assets/journey/f04-02-1200.webp 1086w","width":800,"height":1067,"alt":"An adult at home with a notebook.","fit":"contain","kind":"person"}),
  "F04-03": Object.freeze({"id":"F04-03","cast":"F04","scene":"movement","src":"/assets/journey/f04-03-800.webp","srcSet":"/assets/journey/f04-03-480.webp 480w, /assets/journey/f04-03-800.webp 800w, /assets/journey/f04-03-1200.webp 1086w","width":800,"height":1067,"alt":"An adult enjoying an everyday activity.","fit":"contain","kind":"person"}),
  "F04-04": Object.freeze({"id":"F04-04","cast":"F04","scene":"everyday-routine","src":"/assets/journey/f04-04-800.webp","srcSet":"/assets/journey/f04-04-480.webp 480w, /assets/journey/f04-04-800.webp 800w, /assets/journey/f04-04-1200.webp 1086w","width":800,"height":1067,"alt":"An adult setting out a simple meal at home.","fit":"contain","kind":"person"}),
  "F04-05": Object.freeze({"id":"F04-05","cast":"F04","scene":"review","src":"/assets/journey/f04-05-800.webp","srcSet":"/assets/journey/f04-05-480.webp 480w, /assets/journey/f04-05-800.webp 800w, /assets/journey/f04-05-1200.webp 1086w","width":800,"height":1067,"alt":"An adult organising documents at home.","fit":"contain","kind":"person"}),
  "F05-01": Object.freeze({"id":"F05-01","cast":"F05","scene":"recognition","src":"/assets/journey/f05-01-800.webp","srcSet":"/assets/journey/f05-01-480.webp 480w, /assets/journey/f05-01-800.webp 800w, /assets/journey/f05-01-1200.webp 1086w","width":800,"height":1067,"alt":"An adult at home beside a window.","fit":"contain","kind":"person"}),
  "F05-02": Object.freeze({"id":"F05-02","cast":"F05","scene":"priorities","src":"/assets/journey/f05-02-800.webp","srcSet":"/assets/journey/f05-02-480.webp 480w, /assets/journey/f05-02-800.webp 800w, /assets/journey/f05-02-1200.webp 1086w","width":800,"height":1067,"alt":"An adult at home with a notebook.","fit":"contain","kind":"person"}),
  "F05-03": Object.freeze({"id":"F05-03","cast":"F05","scene":"movement","src":"/assets/journey/f05-03-800.webp","srcSet":"/assets/journey/f05-03-480.webp 480w, /assets/journey/f05-03-800.webp 800w, /assets/journey/f05-03-1200.webp 1086w","width":800,"height":1067,"alt":"An adult enjoying an everyday activity.","fit":"contain","kind":"person"}),
  "F05-04": Object.freeze({"id":"F05-04","cast":"F05","scene":"everyday-routine","src":"/assets/journey/f05-04-800.webp","srcSet":"/assets/journey/f05-04-480.webp 480w, /assets/journey/f05-04-800.webp 800w, /assets/journey/f05-04-1200.webp 1086w","width":800,"height":1067,"alt":"An adult setting out a simple meal at home.","fit":"contain","kind":"person"}),
  "F05-05": Object.freeze({"id":"F05-05","cast":"F05","scene":"review","src":"/assets/journey/f05-05-800.webp","srcSet":"/assets/journey/f05-05-480.webp 480w, /assets/journey/f05-05-800.webp 800w, /assets/journey/f05-05-1200.webp 1086w","width":800,"height":1067,"alt":"An adult organising documents at home.","fit":"contain","kind":"person"}),
  "F06-01": Object.freeze({"id":"F06-01","cast":"F06","scene":"recognition","src":"/assets/journey/f06-01-800.webp","srcSet":"/assets/journey/f06-01-480.webp 480w, /assets/journey/f06-01-800.webp 800w, /assets/journey/f06-01-1200.webp 1086w","width":800,"height":1067,"alt":"An adult at home beside a window.","fit":"contain","kind":"person"}),
  "F06-02": Object.freeze({"id":"F06-02","cast":"F06","scene":"priorities","src":"/assets/journey/f06-02-800.webp","srcSet":"/assets/journey/f06-02-480.webp 480w, /assets/journey/f06-02-800.webp 800w, /assets/journey/f06-02-1200.webp 1086w","width":800,"height":1067,"alt":"An adult at home with a notebook.","fit":"contain","kind":"person"}),
  "F06-03": Object.freeze({"id":"F06-03","cast":"F06","scene":"movement","src":"/assets/journey/f06-03-800.webp","srcSet":"/assets/journey/f06-03-480.webp 480w, /assets/journey/f06-03-800.webp 800w, /assets/journey/f06-03-1200.webp 1086w","width":800,"height":1067,"alt":"An adult enjoying an everyday activity.","fit":"contain","kind":"person"}),
  "F06-04": Object.freeze({"id":"F06-04","cast":"F06","scene":"everyday-routine","src":"/assets/journey/f06-04-800.webp","srcSet":"/assets/journey/f06-04-480.webp 480w, /assets/journey/f06-04-800.webp 800w, /assets/journey/f06-04-1200.webp 1086w","width":800,"height":1067,"alt":"An adult setting out a simple meal at home.","fit":"contain","kind":"person"}),
  "F06-05": Object.freeze({"id":"F06-05","cast":"F06","scene":"review","src":"/assets/journey/f06-05-800.webp","srcSet":"/assets/journey/f06-05-480.webp 480w, /assets/journey/f06-05-800.webp 800w, /assets/journey/f06-05-1200.webp 1086w","width":800,"height":1067,"alt":"An adult organising documents at home.","fit":"contain","kind":"person"}),
  "HOW01": Object.freeze({"id":"HOW01","cast":null,"scene":"baseline","src":"/assets/journey/how01-800.webp","srcSet":"/assets/journey/how01-480.webp 480w, /assets/journey/how01-800.webp 800w, /assets/journey/how01-1200.webp 1200w","width":800,"height":1071,"alt":"A home appointment with sealed supplies ready on a table.","fit":"contain","kind":"person"}),
  "HOW02": Object.freeze({"id":"HOW02","cast":null,"scene":"plan","src":"/assets/journey/how02-800.webp","srcSet":"/assets/journey/how02-480.webp 480w, /assets/journey/how02-800.webp 800w, /assets/journey/how02-1200.webp 1200w","width":800,"height":1071,"alt":"An adult talking with a clinician at home.","fit":"contain","kind":"person"}),
  "HOW03": Object.freeze({"id":"HOW03","cast":null,"scene":"checkins","src":"/assets/journey/how03-800.webp","srcSet":"/assets/journey/how03-480.webp 480w, /assets/journey/how03-800.webp 800w, /assets/journey/how03-1200.webp 1200w","width":800,"height":1071,"alt":"An adult checking a phone at home.","fit":"contain","kind":"person"}),
  "HOW04": Object.freeze({"id":"HOW04","cast":null,"scene":"retest","src":"/assets/journey/how04-800.webp","srcSet":"/assets/journey/how04-480.webp 480w, /assets/journey/how04-800.webp 800w, /assets/journey/how04-1200.webp 1200w","width":800,"height":1071,"alt":"A follow-up home appointment with sealed supplies.","fit":"contain","kind":"person"}),
  "HOW05": Object.freeze({"id":"HOW05","cast":null,"scene":"adjust","src":"/assets/journey/how05-800.webp","srcSet":"/assets/journey/how05-480.webp 480w, /assets/journey/how05-800.webp 800w, /assets/journey/how05-1200.webp 1200w","width":800,"height":1071,"alt":"An adult and a clinician discussing next steps.","fit":"contain","kind":"person"}),
  "M01-01": Object.freeze({"id":"M01-01","cast":"M01","scene":"recognition","src":"/assets/journey/m01-01-800.webp","srcSet":"/assets/journey/m01-01-480.webp 480w, /assets/journey/m01-01-800.webp 800w, /assets/journey/m01-01-1200.webp 1200w","width":800,"height":1071,"alt":"An adult at home beside a window.","fit":"contain","kind":"person"}),
  "M01-02": Object.freeze({"id":"M01-02","cast":"M01","scene":"priorities","src":"/assets/journey/m01-02-800.webp","srcSet":"/assets/journey/m01-02-480.webp 480w, /assets/journey/m01-02-800.webp 800w, /assets/journey/m01-02-1200.webp 1200w","width":800,"height":1071,"alt":"An adult at home with a notebook.","fit":"contain","kind":"person"}),
  "M01-03": Object.freeze({"id":"M01-03","cast":"M01","scene":"movement","src":"/assets/journey/m01-03-800.webp","srcSet":"/assets/journey/m01-03-480.webp 480w, /assets/journey/m01-03-800.webp 800w, /assets/journey/m01-03-1200.webp 1086w","width":800,"height":1067,"alt":"An adult enjoying an everyday activity.","fit":"contain","kind":"person"}),
  "M01-04": Object.freeze({"id":"M01-04","cast":"M01","scene":"everyday-routine","src":"/assets/journey/m01-04-800.webp","srcSet":"/assets/journey/m01-04-480.webp 480w, /assets/journey/m01-04-800.webp 800w, /assets/journey/m01-04-1200.webp 1200w","width":800,"height":1071,"alt":"An adult setting out a simple meal at home.","fit":"contain","kind":"person"}),
  "M01-05": Object.freeze({"id":"M01-05","cast":"M01","scene":"review","src":"/assets/journey/m01-05-800.webp","srcSet":"/assets/journey/m01-05-480.webp 480w, /assets/journey/m01-05-800.webp 800w, /assets/journey/m01-05-1200.webp 1200w","width":800,"height":1071,"alt":"An adult organising documents at home.","fit":"contain","kind":"person"}),
  "M02-01": Object.freeze({"id":"M02-01","cast":"M02","scene":"recognition","src":"/assets/journey/m02-01-800.webp","srcSet":"/assets/journey/m02-01-480.webp 480w, /assets/journey/m02-01-800.webp 800w, /assets/journey/m02-01-1200.webp 1086w","width":800,"height":1067,"alt":"An adult at home beside a window.","fit":"contain","kind":"person"}),
  "M02-02": Object.freeze({"id":"M02-02","cast":"M02","scene":"priorities","src":"/assets/journey/m02-02-800.webp","srcSet":"/assets/journey/m02-02-480.webp 480w, /assets/journey/m02-02-800.webp 800w, /assets/journey/m02-02-1200.webp 1086w","width":800,"height":1067,"alt":"An adult at home with a notebook.","fit":"contain","kind":"person"}),
  "M02-03": Object.freeze({"id":"M02-03","cast":"M02","scene":"movement","src":"/assets/journey/m02-03-800.webp","srcSet":"/assets/journey/m02-03-480.webp 480w, /assets/journey/m02-03-800.webp 800w, /assets/journey/m02-03-1200.webp 1086w","width":800,"height":1067,"alt":"An adult enjoying an everyday activity.","fit":"contain","kind":"person"}),
  "M02-04": Object.freeze({"id":"M02-04","cast":"M02","scene":"everyday-routine","src":"/assets/journey/m02-04-800.webp","srcSet":"/assets/journey/m02-04-480.webp 480w, /assets/journey/m02-04-800.webp 800w, /assets/journey/m02-04-1200.webp 1086w","width":800,"height":1067,"alt":"An adult setting out a simple meal at home.","fit":"contain","kind":"person"}),
  "M02-05": Object.freeze({"id":"M02-05","cast":"M02","scene":"review","src":"/assets/journey/m02-05-800.webp","srcSet":"/assets/journey/m02-05-480.webp 480w, /assets/journey/m02-05-800.webp 800w, /assets/journey/m02-05-1200.webp 1086w","width":800,"height":1067,"alt":"An adult organising documents at home.","fit":"contain","kind":"person"}),
  "M03-01": Object.freeze({"id":"M03-01","cast":"M03","scene":"recognition","src":"/assets/journey/m03-01-800.webp","srcSet":"/assets/journey/m03-01-480.webp 480w, /assets/journey/m03-01-800.webp 800w, /assets/journey/m03-01-1200.webp 1200w","width":800,"height":1071,"alt":"An adult at home beside a window.","fit":"contain","kind":"person"}),
  "M03-02": Object.freeze({"id":"M03-02","cast":"M03","scene":"priorities","src":"/assets/journey/m03-02-800.webp","srcSet":"/assets/journey/m03-02-480.webp 480w, /assets/journey/m03-02-800.webp 800w, /assets/journey/m03-02-1200.webp 1200w","width":800,"height":1071,"alt":"An adult at home with a notebook.","fit":"contain","kind":"person"}),
  "M03-03": Object.freeze({"id":"M03-03","cast":"M03","scene":"movement","src":"/assets/journey/m03-03-800.webp","srcSet":"/assets/journey/m03-03-480.webp 480w, /assets/journey/m03-03-800.webp 800w, /assets/journey/m03-03-1200.webp 1086w","width":800,"height":1067,"alt":"An adult enjoying an everyday activity.","fit":"contain","kind":"person"}),
  "M03-04": Object.freeze({"id":"M03-04","cast":"M03","scene":"everyday-routine","src":"/assets/journey/m03-04-800.webp","srcSet":"/assets/journey/m03-04-480.webp 480w, /assets/journey/m03-04-800.webp 800w, /assets/journey/m03-04-1200.webp 1200w","width":800,"height":1071,"alt":"An adult setting out a simple meal at home.","fit":"contain","kind":"person"}),
  "M03-05": Object.freeze({"id":"M03-05","cast":"M03","scene":"review","src":"/assets/journey/m03-05-800.webp","srcSet":"/assets/journey/m03-05-480.webp 480w, /assets/journey/m03-05-800.webp 800w, /assets/journey/m03-05-1200.webp 1200w","width":800,"height":1071,"alt":"An adult organising documents at home.","fit":"contain","kind":"person"}),
  "M04-01": Object.freeze({"id":"M04-01","cast":"M04","scene":"recognition","src":"/assets/journey/m04-01-800.webp","srcSet":"/assets/journey/m04-01-480.webp 480w, /assets/journey/m04-01-800.webp 800w, /assets/journey/m04-01-1200.webp 1086w","width":800,"height":1067,"alt":"An adult at home beside a window.","fit":"contain","kind":"person"}),
  "M04-02": Object.freeze({"id":"M04-02","cast":"M04","scene":"priorities","src":"/assets/journey/m04-02-800.webp","srcSet":"/assets/journey/m04-02-480.webp 480w, /assets/journey/m04-02-800.webp 800w, /assets/journey/m04-02-1200.webp 1086w","width":800,"height":1067,"alt":"An adult at home with a notebook.","fit":"contain","kind":"person"}),
  "M04-03": Object.freeze({"id":"M04-03","cast":"M04","scene":"movement","src":"/assets/journey/m04-03-800.webp","srcSet":"/assets/journey/m04-03-480.webp 480w, /assets/journey/m04-03-800.webp 800w, /assets/journey/m04-03-1200.webp 1086w","width":800,"height":1067,"alt":"An adult enjoying an everyday activity.","fit":"contain","kind":"person"}),
  "M04-04": Object.freeze({"id":"M04-04","cast":"M04","scene":"everyday-routine","src":"/assets/journey/m04-04-800.webp","srcSet":"/assets/journey/m04-04-480.webp 480w, /assets/journey/m04-04-800.webp 800w, /assets/journey/m04-04-1200.webp 1086w","width":800,"height":1067,"alt":"An adult setting out a simple meal at home.","fit":"contain","kind":"person"}),
  "M04-05": Object.freeze({"id":"M04-05","cast":"M04","scene":"review","src":"/assets/journey/m04-05-800.webp","srcSet":"/assets/journey/m04-05-480.webp 480w, /assets/journey/m04-05-800.webp 800w, /assets/journey/m04-05-1200.webp 1086w","width":800,"height":1067,"alt":"An adult organising documents at home.","fit":"contain","kind":"person"}),
  "M05-01": Object.freeze({"id":"M05-01","cast":"M05","scene":"recognition","src":"/assets/journey/m05-01-800.webp","srcSet":"/assets/journey/m05-01-480.webp 480w, /assets/journey/m05-01-800.webp 800w, /assets/journey/m05-01-1200.webp 1086w","width":800,"height":1067,"alt":"An adult at home beside a window.","fit":"contain","kind":"person"}),
  "M05-02": Object.freeze({"id":"M05-02","cast":"M05","scene":"priorities","src":"/assets/journey/m05-02-800.webp","srcSet":"/assets/journey/m05-02-480.webp 480w, /assets/journey/m05-02-800.webp 800w, /assets/journey/m05-02-1200.webp 1086w","width":800,"height":1067,"alt":"An adult at home with a notebook.","fit":"contain","kind":"person"}),
  "M05-03": Object.freeze({"id":"M05-03","cast":"M05","scene":"movement","src":"/assets/journey/m05-03-800.webp","srcSet":"/assets/journey/m05-03-480.webp 480w, /assets/journey/m05-03-800.webp 800w, /assets/journey/m05-03-1200.webp 1086w","width":800,"height":1067,"alt":"An adult enjoying an everyday activity.","fit":"contain","kind":"person"}),
  "M05-04": Object.freeze({"id":"M05-04","cast":"M05","scene":"everyday-routine","src":"/assets/journey/m05-04-800.webp","srcSet":"/assets/journey/m05-04-480.webp 480w, /assets/journey/m05-04-800.webp 800w, /assets/journey/m05-04-1200.webp 1086w","width":800,"height":1067,"alt":"An adult setting out a simple meal at home.","fit":"contain","kind":"person"}),
  "M05-05": Object.freeze({"id":"M05-05","cast":"M05","scene":"review","src":"/assets/journey/m05-05-800.webp","srcSet":"/assets/journey/m05-05-480.webp 480w, /assets/journey/m05-05-800.webp 800w, /assets/journey/m05-05-1200.webp 1086w","width":800,"height":1067,"alt":"An adult organising documents at home.","fit":"contain","kind":"person"}),
  "M06-01": Object.freeze({"id":"M06-01","cast":"M06","scene":"recognition","src":"/assets/journey/m06-01-800.webp","srcSet":"/assets/journey/m06-01-480.webp 480w, /assets/journey/m06-01-800.webp 800w, /assets/journey/m06-01-1200.webp 1086w","width":800,"height":1067,"alt":"An adult at home beside a window.","fit":"contain","kind":"person"}),
  "M06-02": Object.freeze({"id":"M06-02","cast":"M06","scene":"priorities","src":"/assets/journey/m06-02-800.webp","srcSet":"/assets/journey/m06-02-480.webp 480w, /assets/journey/m06-02-800.webp 800w, /assets/journey/m06-02-1200.webp 1086w","width":800,"height":1067,"alt":"An adult at home with a notebook.","fit":"contain","kind":"person"}),
  "M06-03": Object.freeze({"id":"M06-03","cast":"M06","scene":"movement","src":"/assets/journey/m06-03-800.webp","srcSet":"/assets/journey/m06-03-480.webp 480w, /assets/journey/m06-03-800.webp 800w, /assets/journey/m06-03-1200.webp 1086w","width":800,"height":1067,"alt":"An adult enjoying an everyday activity.","fit":"contain","kind":"person"}),
  "M06-04": Object.freeze({"id":"M06-04","cast":"M06","scene":"everyday-routine","src":"/assets/journey/m06-04-800.webp","srcSet":"/assets/journey/m06-04-480.webp 480w, /assets/journey/m06-04-800.webp 800w, /assets/journey/m06-04-1200.webp 1086w","width":800,"height":1067,"alt":"An adult setting out a simple meal at home.","fit":"contain","kind":"person"}),
  "M06-05": Object.freeze({"id":"M06-05","cast":"M06","scene":"review","src":"/assets/journey/m06-05-800.webp","srcSet":"/assets/journey/m06-05-480.webp 480w, /assets/journey/m06-05-800.webp 800w, /assets/journey/m06-05-1200.webp 1086w","width":800,"height":1067,"alt":"An adult organising documents at home.","fit":"contain","kind":"person"}),
  "NATURE01": Object.freeze({"id":"NATURE01","cast":null,"scene":"water","src":"/assets/journey/nature-coast-800.webp","srcSet":"/assets/journey/nature-coast-480.webp 480w, /assets/journey/nature-coast-800.webp 800w, /assets/journey/nature-coast-1200.webp 1200w","width":800,"height":448,"alt":"Calm water meeting a pale sky and sandy shoreline.","fit":"cover","kind":"environment"}),
  "NATURE02": Object.freeze({"id":"NATURE02","cast":null,"scene":"water-detail","src":"/assets/journey/scenery-water-800.webp","srcSet":"/assets/journey/scenery-water-480.webp 480w, /assets/journey/scenery-water-800.webp 800w, /assets/journey/scenery-water-1086.webp 1086w","width":800,"height":1067,"alt":"Sunlight moving across clear water.","fit":"cover","kind":"environment"}),
  "NATURE03": Object.freeze({"id":"NATURE03","cast":null,"scene":"dunes","src":"/assets/journey/scenery-dunes-800.webp","srcSet":"/assets/journey/scenery-dunes-480.webp 480w, /assets/journey/scenery-dunes-800.webp 800w, /assets/journey/scenery-dunes-1086.webp 1086w","width":800,"height":1067,"alt":"Soft light across sculpted desert dunes.","fit":"cover","kind":"environment"}),
  "NATURE04": Object.freeze({"id":"NATURE04","cast":null,"scene":"sky","src":"/assets/journey/scenery-clouds-800.webp","srcSet":"/assets/journey/scenery-clouds-480.webp 480w, /assets/journey/scenery-clouds-800.webp 800w, /assets/journey/scenery-clouds-1086.webp 1086w","width":800,"height":1067,"alt":"Clouds moving through an open sky.","fit":"cover","kind":"environment"}),
  "NATURE05": Object.freeze({"id":"NATURE05","cast":null,"scene":"foliage","src":"/assets/journey/scenery-foliage-800.webp","srcSet":"/assets/journey/scenery-foliage-480.webp 480w, /assets/journey/scenery-foliage-800.webp 800w, /assets/journey/scenery-foliage-1086.webp 1086w","width":800,"height":1067,"alt":"Sunlight filtering through green foliage.","fit":"cover","kind":"environment"}),
  "NATURE06": Object.freeze({"id":"NATURE06","cast":null,"scene":"light-study","src":"/assets/journey/scenery-shadow-800.webp","srcSet":"/assets/journey/scenery-shadow-480.webp 480w, /assets/journey/scenery-shadow-800.webp 800w, /assets/journey/scenery-shadow-1086.webp 1086w","width":800,"height":1067,"alt":"Soft sunlight and shadows across a pale surface.","fit":"cover","kind":"environment"}),
  "ROUTE01": Object.freeze({"id":"ROUTE01","cast":null,"scene":"assessment","src":"/assets/journey/route01-800.webp","srcSet":"/assets/journey/route01-480.webp 480w, /assets/journey/route01-800.webp 800w, /assets/journey/route01-1200.webp 1200w","width":800,"height":600,"alt":"Sealed sample-collection supplies prepared for an assessment.","fit":"cover","kind":"route"}),
  "ROUTE02": Object.freeze({"id":"ROUTE02","cast":null,"scene":"consultation","src":"/assets/journey/route02-800.webp","srcSet":"/assets/journey/route02-480.webp 480w, /assets/journey/route02-800.webp 800w, /assets/journey/route02-1200.webp 1200w","width":800,"height":600,"alt":"A clinician speaking during a video consultation.","fit":"cover","kind":"route"}),
});

/** @type {Readonly<Record<string, Readonly<Record<string,string>>>>} */
const CAST_BY_AGE = Object.freeze({
  '18-30': Object.freeze({female:'F04', male:'M04'}),
  '31-40': Object.freeze({female:'F01', male:'M01'}),
  '41-50': Object.freeze({female:'F02', male:'M02'}),
  '51-60': Object.freeze({female:'F05', male:'M05'}),
  '61-70': Object.freeze({female:'F03', male:'M03'}),
  '71-plus': Object.freeze({female:'F06', male:'M06'}),
});
/** @type {Readonly<Record<string,string>>} */
const SCENE_NUMBERS = Object.freeze({
  recognition:'01', priorities:'02', movement:'03', 'everyday-routine':'04', review:'05',
});
/** @type {Readonly<Record<string,string>>} */
const ROUTE_IDS = Object.freeze({
  'complete-assessment':'ROUTE01',
  'consultation-only':'ROUTE02',
});
// The welcome clinic is fixed. Nature gives each section a quiet visual pause;
// these choices depend on the screen, never on sensitive answers.
/** @type {Readonly<Record<string,string>>} */
const SCENERY_BY_STEP = Object.freeze({
  goals:'NATURE02', curiosity:'NATURE02', contact:'NATURE02',
  age:'ENV02', delivery:'ENV02',
  sex:'NATURE03', country:'NATURE03', history:'NATURE03',
  location:'NATURE04', prevention:'NATURE04', transition:'NATURE04',
  treatment:'NATURE05', sleep:'NATURE05', family:'NATURE05',
  pregnancy:'NATURE06', hormones:'NATURE06',
});
const RECOGNITION_STEPS = new Set(['context','reassurance']);
const PRIORITY_STEPS = new Set(['motivation','priority','symptoms','checkup']);
const REVIEW_STEPS = new Set(['bloodwork','summary','overview','consultation','consultation-receipt','finished']);
const ROUTE_STEPS = new Set(['route-waitlist','route-waitlist-receipt']);

/** The care sequence uses its established illustrative cast, independent of questionnaire answers. */
export const CARE_VISUALS = Object.freeze({
  baseline:JOURNEY_VISUALS.HOW01,
  plan:JOURNEY_VISUALS.HOW02,
  checkins:JOURNEY_VISUALS.HOW03,
  retest:JOURNEY_VISUALS.HOW04,
  adjust:JOURNEY_VISUALS.HOW05,
});

/**
 * Select only an explicitly supported age/sex pair; never guess missing demographics.
 * @param {{age?:string,sex?:string}} [answers]
 * @param {string} [scene]
 */
export function getProfileVisual(answers={}, scene='recognition') {
  const age = answers?.age;
  const sex = answers?.sex;
  if (typeof age !== 'string' || typeof sex !== 'string' || !Object.hasOwn(CAST_BY_AGE, age) || !['female','male'].includes(sex)) return JOURNEY_VISUALS.ENV02;
  if (!Object.hasOwn(SCENE_NUMBERS, scene)) return JOURNEY_VISUALS.ENV02;
  const cast = CAST_BY_AGE[age][sex];
  return JOURNEY_VISUALS[`${cast}-${SCENE_NUMBERS[scene]}`];
}

/**
 * Stable product IDs from journey-offers.mjs; unknown products get neutral imagery.
 * @param {string} [routeId]
 */
export function getRouteVisual(routeId) {
  return typeof routeId === 'string' && Object.hasOwn(ROUTE_IDS, routeId) ? JOURNEY_VISUALS[ROUTE_IDS[routeId]] : JOURNEY_VISUALS.ENV02;
}

/**
 * Interleave the recurring person with calming nature. Sensitive exits stay
 * neutral even when answers or a route selection are retained. Only the
 * performance screen depicts activity; preferences do not change this cadence.
 * @param {string} step
 * @param {{age?:string,sex?:string}} [answers]
 * @param {{routeId?:string,neutral?:boolean}} [options]
 * @returns {Readonly<JourneyVisual>}
 */
export function getJourneyVisual(step, answers={}, options={}) {
  if (options?.neutral || typeof step !== 'string' || step.endsWith('-exit') || /availability|regional/.test(step)) return JOURNEY_VISUALS.ENV02;
  if (step === 'welcome') return JOURNEY_VISUALS.CLINIC01;
  if (Object.hasOwn(SCENERY_BY_STEP,step)) return JOURNEY_VISUALS[SCENERY_BY_STEP[step]];
  if (ROUTE_STEPS.has(step)) return getRouteVisual(options?.routeId);
  if (RECOGNITION_STEPS.has(step)) return getProfileVisual(answers);
  if (PRIORITY_STEPS.has(step)) return getProfileVisual(answers,'priorities');
  if (step === 'performance') return getProfileVisual(answers,'movement');
  if (step === 'weight') return getProfileVisual(answers,'everyday-routine');
  if (REVIEW_STEPS.has(step)) return getProfileVisual(answers,'review');
  return JOURNEY_VISUALS.ENV02;
}
