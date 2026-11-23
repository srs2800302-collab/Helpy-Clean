import { compose } from './composition.js';
import { serveRequest } from './http-runtime.js';

export default {
  fetch(request:Request,env:Env):Promise<Response> {return serveRequest(request,compose(env));},
} satisfies ExportedHandler<Env>;
