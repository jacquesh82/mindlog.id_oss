// Déclaration minimale pour le paquet `mjml` (pas de types fournis).
declare module "mjml" {
  interface MjmlOptions {
    minify?: boolean;
    validationLevel?: "strict" | "soft" | "skip";
    keepComments?: boolean;
  }
  interface MjmlResult {
    html: string;
    errors: Array<{ line: number; message: string; tagName?: string }>;
  }
  // mjml v5 : compilation asynchrone (renvoie une Promise).
  export default function mjml2html(mjml: string, options?: MjmlOptions): Promise<MjmlResult>;
}
