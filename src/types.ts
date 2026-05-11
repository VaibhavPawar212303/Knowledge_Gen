export interface Project {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  createdAt: any;
}

export interface TestCase {
  id: string;
  projectId: string;
  title: string;
  flow: string;
  steps: string[];
  expectedResult: string;
  status: 'draft' | 'active' | 'deprecated';
  authorId: string;
  createdAt: any;
  updatedAt?: any;
}

export interface Document {
  id: string;
  projectId: string;
  name: string;
  content: string;
  rawContent?: string;
  category: 'api' | 'functional' | 'technical' | 'general';
  type: string;
  ownerId: string;
  createdAt: any;
}
