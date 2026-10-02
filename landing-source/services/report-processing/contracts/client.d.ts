/** report-upload-v1: shared questionnaire/operator contract for fictional cases. */
export type ReportStatus = 'uploading' | 'queued' | 'processing' | 'ready' | 'failed' | 'rejected';
export type ReportMime = 'application/pdf' | 'image/jpeg' | 'image/png';
export interface UploadSession {sessionId:string;token:string}
export interface UploadMetadata {name:string;type:ReportMime;size:number;sha256:string}
export interface UploadPermission {reportId:string;status:ReportStatus;uploadUrl:string}
export interface UploadCompletion {reportId:string;status:'queued'|'processing'|'ready'}
export interface ReportReferences {reports:[];reportIds:string[];reportSession:{id:string;token:string}}
export interface Observation {
  name:string|null;value:string|null;unit:string|null;referenceRange:string|null;date:string|null;
  page:number;sourceText:string|null;
}
export interface SourcePage {number:number;text:string;lines:Array<{text:string;bounds?:unknown}>}
export interface Extraction {id:string;reportId:string;processorVersion:string;inputSha256:string;pages:SourcePage[];observations:Observation[];warnings:string[];createdAt:string}
export interface ReviewInput {extractionId:string;expectedReviewRevision:number;observations:Observation[];decision:'approved'|'corrected'|'needs_changes'}
export interface Review extends Omit<ReviewInput,'expectedReviewRevision'> {id:string;reportId:string;revision:number;actor:string;createdAt:string}
export interface Report {id:string;name:string;type:ReportMime;size:number;status:ReportStatus;errorCode:string|null;pageCount:number|null;createdAt:string;extraction:Extraction|null;reviews:Review[]}
export interface CaseSummary {id:string;receiptId:string;firstName:string;createdAt:string;reportCount:number;readyCount:number}
export interface CaseDetail {case:Omit<CaseSummary,'reportCount'|'readyCount'>;reports:Report[]}
export interface ApiError {message:string;code?:string}
