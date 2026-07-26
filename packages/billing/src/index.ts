// Voxly Robokassa billing client
// Pay interface + Result/Success signatures per docs.robokassa.ru
// Fiscal Receipt (54-ФЗ) included in payment signature when present

import { createHash } from 'node:crypto';

export interface RobokassaConfig {
  merchantLogin: string;
  password1: string;
  password2: string;
  isTest: boolean;
}

/** Robokassa Receipt.payment_method values (54-ФЗ) */
export type RobokassaPaymentMethod =
  | 'full_payment'
  | 'full_prepayment'
  | 'prepayment'
  | 'advance'
  | 'partial_payment'
  | 'credit'
  | 'credit_payment';

/** Robokassa Receipt.payment_object values */
export type RobokassaPaymentObject =
  | 'service'
  | 'commodity'
  | 'intellectual_activity'
  | 'payment'
  | 'another';

export interface CheckoutItem {
  name: string;
  quantity: number;
  price: number;
  tax: 'none' | 'vat0' | 'vat10' | 'vat20' | 'vat22' | 'vat5' | 'vat7';
  paymentMethod: RobokassaPaymentMethod;
  paymentObject: RobokassaPaymentObject;
}

export interface CheckoutParams {
  invId: number;
  amount: number;
  description: string;
  email?: string;
  items: CheckoutItem[];
  customData?: Record<string, string>; // shp_* parameters
}

export class RobokassaClient {
  private readonly config: RobokassaConfig;
  private readonly baseUrl = 'https://auth.robokassa.ru/Merchant/Index.aspx';

  constructor(config: RobokassaConfig) {
    this.config = config;
  }

  /**
   * Generate payment URL for redirect.
   * Signature (pay-interface):
   *   MerchantLogin:OutSum:InvId[:Receipt]:Password#1[:shp_*=…]
   * Receipt in the signature string must be URL-encoded.
   */
  generatePaymentUrl(params: CheckoutParams): string {
    const outSum = params.amount.toFixed(2);
    const shpSuffix = this.buildShpSuffix(params.customData);
    const receipt = this.buildReceipt(params.items, params.email);
    const receiptJson = receipt ? JSON.stringify(receipt) : null;
    const receiptEncoded = receiptJson ? encodeURIComponent(receiptJson) : null;

    const signature = receiptEncoded
      ? this.hash(
          `${this.config.merchantLogin}:${outSum}:${params.invId}:${receiptEncoded}:${this.config.password1}${shpSuffix}`,
        )
      : this.hash(
          `${this.config.merchantLogin}:${outSum}:${params.invId}:${this.config.password1}${shpSuffix}`,
        );

    const url = new URL(this.baseUrl);
    url.searchParams.set('MerchantLogin', this.config.merchantLogin);
    url.searchParams.set('OutSum', outSum);
    url.searchParams.set('InvId', String(params.invId));
    url.searchParams.set(
      'Description',
      params.description.slice(0, 100).replace(/[<>&"']/g, ''),
    );
    url.searchParams.set('SignatureValue', signature);

    if (params.email) {
      url.searchParams.set('Email', params.email);
    }

    if (this.config.isTest) {
      url.searchParams.set('IsTest', '1');
    }

    // Pass raw JSON; URLSearchParams encodes once for the query string.
    // Signature above used encodeURIComponent of the same JSON (Robokassa docs).
    if (receiptJson) {
      url.searchParams.set('Receipt', receiptJson);
    }

    if (params.customData) {
      for (const [key, value] of Object.entries(params.customData)) {
        url.searchParams.set(`shp_${key}`, value);
      }
    }

    return url.toString();
  }

  /**
   * Verify ResultURL webhook (Password #2).
   * Docs: OutSum:InvId:Password#2[:shp_*] — use OutSum exactly as received
   * (prod may send 6 decimal places).
   */
  verifyResultSignature(params: {
    outSum: string;
    invId: string;
    signatureValue: string;
    customData?: Record<string, string>;
  }): boolean {
    const shpSuffix = this.buildShpSuffix(params.customData);
    const expected = this.hash(
      `${params.outSum}:${params.invId}:${this.config.password2}${shpSuffix}`,
    );
    return this.safeCompare(expected, params.signatureValue.toLowerCase());
  }

  /**
   * Verify SuccessURL redirect (Password #1).
   * Docs: OutSum:InvId:Password#1[:shp_*]
   */
  verifySuccessSignature(params: {
    outSum: string;
    invId: string;
    signatureValue: string;
    customData?: Record<string, string>;
  }): boolean {
    const shpSuffix = this.buildShpSuffix(params.customData);
    const expected = this.hash(
      `${params.outSum}:${params.invId}:${this.config.password1}${shpSuffix}`,
    );
    return this.safeCompare(expected, params.signatureValue.toLowerCase());
  }

  private hash(stringToSign: string): string {
    return createHash('sha256').update(stringToSign).digest('hex');
  }

  private buildShpSuffix(customData?: Record<string, string>): string {
    if (!customData || Object.keys(customData).length === 0) return '';
    return Object.keys(customData)
      .sort()
      .map((k) => `:shp_${k}=${customData[k]}`)
      .join('');
  }

  private buildReceipt(items: CheckoutItem[], email?: string) {
    if (items.length === 0) return null;
    return {
      items: items.map((item) => ({
        name: item.name.slice(0, 128),
        quantity: item.quantity,
        sum: Math.round(item.price * item.quantity * 100) / 100,
        payment_method: item.paymentMethod,
        payment_object: item.paymentObject,
        tax: item.tax,
      })),
      ...(email ? { email } : {}),
    };
  }

  private safeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }
}

/**
 * Calculate subscription price with period discount
 */
export function calculateSubscriptionPrice(
  monthlyPrice: number,
  periodMonths: number,
  discountPercent: number,
): number {
  const base = monthlyPrice * periodMonths;
  const discount = (base * discountPercent) / 100;
  return Math.round((base - discount) * 100) / 100;
}

/**
 * Calculate prorated seat price for mid-period addition
 */
export function calculateProratedSeatPrice(
  monthlyPrice: number,
  remainingDays: number,
  totalDaysInPeriod: number,
): number {
  return Math.round((monthlyPrice * (remainingDays / totalDaysInPeriod)) * 100) / 100;
}
