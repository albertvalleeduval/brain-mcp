/** Authenticated user props, threaded from the OAuth handler into the MCP agent. */
export interface Props {
  login: string;
  name: string;
  email: string;
  [key: string]: unknown;
}
