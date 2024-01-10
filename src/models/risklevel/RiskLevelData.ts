export interface RiskLevelData {
  protocolName: string;
  global: GlobalData[];
  items: Item[];
}

interface GlobalData {
  chain: string;
  averageRiskLevelHistory: RiskLevelHistory[];
}

interface Item {
  name: string;
  chain: string;
  baseAsset: string;
  riskLevels: RiskLevel[];
}

interface RiskLevel {
  collateral: string;
  riskLevel7D: RiskLevelHistory[];
  riskLevel30D: RiskLevelHistory[];
  riskLevel180D: RiskLevelHistory[];
}

interface RiskLevelHistory {
  date: number;
  riskLevel: number;
}
