import { axiosForBackend } from '@client/src/api/http';
import type {
  CostEstimateRequest,
  CostEstimateResponse,
  OfficialChannelInfo,
  OfficialChannelUpdateRequest,
  PriceItem,
  PricingUpdateRequest,
} from '@shared/api.interface';

export const getPricing = () =>
  axiosForBackend.get<PriceItem[]>('/api/billing/pricing').then((res) => res.data);

export const updatePricing = (modelKey: string, data: PricingUpdateRequest) =>
  axiosForBackend
    .patch<PriceItem>(`/api/billing/pricing/${modelKey}`, data)
    .then((res) => res.data);

export const getOfficial = () =>
  axiosForBackend
    .get<OfficialChannelInfo>('/api/billing/official')
    .then((res) => res.data);

export const updateOfficial = (data: OfficialChannelUpdateRequest) =>
  axiosForBackend
    .patch<OfficialChannelInfo>('/api/billing/official', data)
    .then((res) => res.data);

export const estimateCost = (data: CostEstimateRequest) =>
  axiosForBackend
    .post<CostEstimateResponse>('/api/billing/estimate', data)
    .then((res) => res.data);
