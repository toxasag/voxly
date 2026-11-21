declare module "qrcode" {
  export type QRCodeErrorCorrectionLevel = "L" | "M" | "Q" | "H";

  export interface QRCodeToDataURLOptions {
    type?: string;
    margin?: number;
    width?: number;
    scale?: number;
    errorCorrectionLevel?: QRCodeErrorCorrectionLevel;
    color?: {
      dark?: string;
      light?: string;
    };
  }

  export interface QRCodeToStringOptions {
    type?: "svg" | "utf8" | "terminal";
    margin?: number;
    width?: number;
    scale?: number;
    errorCorrectionLevel?: QRCodeErrorCorrectionLevel;
  }

  export interface QRCodeMatrix {
    modules: {
      size: number;
      get(row: number, col: number): number;
    };
  }

  export function create(
    text: string,
    options?: { errorCorrectionLevel?: QRCodeErrorCorrectionLevel },
  ): QRCodeMatrix;

  export function toDataURL(
    text: string | Buffer,
    options?: QRCodeToDataURLOptions,
  ): Promise<string>;

  export function toString(
    text: string | Buffer,
    options?: QRCodeToStringOptions,
  ): Promise<string>;
}
