import type {ErrorCode, SubmissionRequest, SubmissionSaved, TraceId} from './contracts/client.js';

export type ClientErrorCode = ErrorCode | 'invalid_configuration' | 'invalid_request'
  | 'unsupported_report_references' | 'request_too_large' | 'timeout' | 'transport_error' | 'invalid_response';
/** unknown means a POST may have committed. Retry only the identical request and ID. */
export type SubmissionOutcome = 'not_sent' | 'rejected' | 'unknown' | 'not_applicable';
export interface ClientErrorDetails {
  kind?: 'configuration' | 'request' | 'transport' | 'response' | 'api';
  status?: number;
  traceId?: TraceId;
  retryAfterSeconds?: number;
  submissionOutcome?: SubmissionOutcome;
}
export class NamatApiClientError extends Error {
  constructor(code: ClientErrorCode, details?: ClientErrorDetails);
  readonly kind: NonNullable<ClientErrorDetails['kind']>;
  readonly code: ClientErrorCode;
  readonly submissionOutcome: SubmissionOutcome;
  readonly status?: number;
  readonly traceId?: TraceId;
  readonly retryAfterSeconds?: number;
}
interface BaseOptions {
  baseUrl: string;
  /** Integer from 100 to 60,000; default 45,000. Includes reading the response. */
  timeoutMs?: number;
  /** For server-side tests or an audited transport. Must honor redirect and abort settings. */
  fetcher?: typeof fetch;
}
export type NamatApiClientOptions = BaseOptions & (
  | {mode: 'synthetic-staging'; stagingToken: string; origin?: never}
  | {mode: 'synthetic-local'; origin?: string; stagingToken?: never}
);
/** The client supplies the current pinned revision if absent; it never replaces another revision. */
export type ClientSubmission = Omit<SubmissionRequest, 'questionnaireRevision'>
  & Partial<Pick<SubmissionRequest, 'questionnaireRevision'>>;
export interface NamatApiClient {
  submitSubmission(input: ClientSubmission): Promise<{status: 201; data: SubmissionSaved; traceId: TraceId}>;
  getReadiness(): Promise<{ready: boolean; status: 200 | 503; traceId: TraceId}>;
  getContract(): Promise<{status: 200; data: Record<string, unknown>; traceId: TraceId}>;
}
/** Server only. Never exposes credentials, retries, falls back or sends email. */
export function createNamatApiClient(options: NamatApiClientOptions): NamatApiClient;
