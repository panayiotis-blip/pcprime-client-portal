export interface Client {
  id?: number;
  name: string;
  contactEmail: string;
  phone: string;
  address: string;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}
