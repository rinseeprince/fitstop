// Children-slot fallback: when the intercepted create-session URL is reached
// by soft navigation from OUTSIDE the builder, the children slot has no
// previous state to retain — render the builder page under it (the slide-over
// resumes on top). Without this, that navigation would 404.
export { default } from "./page";
