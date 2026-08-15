/** Durable attachment storage seam (`ctx.attachments`). @module @deepseek-ai/dsh-attachment */
import { Service } from '@deepseek-ai/cordis';
export { AttachmentId } from "./brand.js";
export { AttachmentError } from "./error.js";
/** Immutable binary attachment service. Implementations validate bytes before publishing a reference. */
export class AttachmentStore extends Service {
    constructor(ctx) {
        super(ctx, 'attachments');
    }
}
export default AttachmentStore;
//# sourceMappingURL=index.js.map