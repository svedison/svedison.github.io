// Single source of truth for the Workshop artifacts and the Logbook (SPEC.md §6).
// Every fact here traces to Atlassian-Data-Engineer-2027-Graduate-Resume.pdf.
// Do NOT add metrics, clients or claims that are not in the PDF.

export type ArtifactId =
  | 'golden-record'
  | 'cargo-truck'
  | 'brass-lens'
  | 'wheat-sheaf'
  | 'pudding-cup'
  | 'seed-cloche'
  | 'diploma'
  | 'toolbox';

export interface ResumeEntry {
  id: ArtifactId;
  kind: 'experience' | 'project' | 'education' | 'skills';
  /** The physical object on the Workshop shelf. */
  artifact: string;
  /** Why this object (shown as a small margin note). */
  why: string;
  org: string;
  role: string;
  dates: string;
  place?: string;
  bullets: string[];
  status?: string;
}

export const SUMMARY =
  'UW senior in Applied & Computational Mathematical Sciences (Discrete Math & Algorithms), graduating June 2027 and available to start Summer 2027, with three software engineering internships centered on data platforms and pipelines.';

export const RESUME: ResumeEntry[] = [
  {
    id: 'golden-record',
    kind: 'experience',
    artifact: 'A golden record',
    why: 'Master data management produces golden records.',
    org: 'Symetra',
    role: 'Data Engineer Intern',
    dates: 'Jul 2026 – Present (Expected Oct 2026)',
    place: 'Bellevue, WA',
    bullets: [
      'Independently designed, built, and optimized an end-to-end master data management (MDM) pipeline on Amazon Aurora PostgreSQL; significantly reduced runtime with batch processing and validated the proof of concept on hundreds of thousands of production-database records.',
      'Implemented deterministic/probabilistic matching, Union-Find clustering, and attribute-level survivorship to reconcile three legacy insurance-agent sources into golden records with field-level lineage.',
      'Developed a full-stack data stewardship application using FastAPI and React/TypeScript, enabling field overrides, record splitting, audit trails, and match tuning; demonstrated to senior leadership.',
      'Validated application functionality with 134+ unit tests and built a synthetic-data generator with invariant validation to support testing.',
    ],
  },
  {
    id: 'cargo-truck',
    kind: 'experience',
    artifact: 'A toy cargo truck and crate',
    why: 'An automotive supply-chain prototype.',
    org: 'Capgemini',
    role: 'Software Engineer Intern',
    dates: 'Jun 2026 – Jul 2026',
    place: 'Bellevue, WA',
    bullets: [
      'Led PostgreSQL database development for a multi-agent automotive supply-chain automation prototype in the AI Center of Excellence; the team demonstrated the working prototype to senior leadership.',
      'Developed FastAPI services and synthetic-data ingestion components to simulate supply-chain behavior and support future production integration.',
      // Client name withheld until Jay confirms it can be public (SPEC §15.2 Q5).
      'Built a full-stack security-vulnerability automation proof of concept for a major retail client with FastAPI and React, demonstrated to senior leadership for potential production adoption.',
    ],
  },
  {
    id: 'brass-lens',
    kind: 'experience',
    artifact: 'A brass spyglass',
    why: 'Eye Spy: seeing patterns in data.',
    org: 'Eye Spy Foundation',
    role: 'Software Engineer Intern',
    dates: 'Jun 2025 – Aug 2025',
    place: 'Jacksonville, FL',
    bullets: [
      'Built Python pipelines with REST API ingestion and data validation to integrate 10+ external datasets and 50K+ transactional records; reduced batch preprocessing time 30%, from 5.0 to 3.5 hours.',
      'Developed a Python/SQL machine-learning scoring system to segment campaign opportunities and automate performance evaluation, improving targeting precision 35%.',
    ],
  },
  {
    id: 'wheat-sheaf',
    kind: 'project',
    artifact: 'A wheat sheaf under a small rain cloud',
    why: 'Crop yields, read against the weather.',
    org: 'Climate Yield Anomaly Detection',
    role: 'Databricks ML Hackathon · Data Science & ML Contributor',
    dates: 'Feb 2026',
    place: 'Seattle, WA',
    bullets: [
      'Engineered a distributed Python/Apache Spark pipeline on Databricks processing 4.5M+ USDA and NOAA records for crop-yield modeling and anomaly detection.',
      'Trained XGBoost regression models on weather variables and applied SHAP to explain feature contributions to non-technical audiences.',
    ],
  },
  {
    id: 'pudding-cup',
    kind: 'project',
    artifact: 'A pudding cup with a paw print',
    why: 'It’s the name.',
    org: 'Creme Pudding Pet Shop',
    role: 'E-commerce Startup · Founder & Operator',
    dates: 'Mar 2025 – Present',
    place: 'Seattle, WA',
    bullets: [
      'Ran pricing A/B tests using formal statistical hypothesis testing, increasing click-through rate 28% (2.5% to 3.2%); built analytics dashboards tracking acquisition cost, conversion, and demand trends.',
    ],
  },
  {
    id: 'seed-cloche',
    kind: 'project',
    artifact: 'A seed under a glass cloche',
    why: 'Something growing, not finished yet.',
    org: 'Personal well-being app',
    role: 'Builder',
    dates: 'Now',
    bullets: ['Currently building an app for the future of personal well-being.'],
    status: 'In progress',
  },
  {
    id: 'diploma',
    kind: 'education',
    artifact: 'A diploma tube with a ribbon',
    why: 'Almost there.',
    org: 'University of Washington',
    role: 'B.S. Applied & Computational Mathematical Sciences · Discrete Math & Algorithms',
    dates: 'Expected June 2027',
    place: 'Seattle, WA',
    bullets: [
      'GPA 3.70 / 4.00 · Dean’s List.',
      'Coursework: Data Structures & Algorithms, Probability, Statistical Modeling, Machine Learning.',
      'Leadership: Student Leader, Chinese Student Organization; led cross-functional marketing initiatives reaching 2,000+ students.',
    ],
  },
  {
    id: 'toolbox',
    kind: 'skills',
    artifact: 'A toolbox drawer',
    why: 'Tools, not percentages.',
    org: 'Technical skills',
    role: '',
    dates: '',
    bullets: [
      'Languages: Python, Java, TypeScript, JavaScript, SQL',
      'Frameworks & APIs: FastAPI, React, REST APIs',
      'Cloud & Data: AWS (Amazon Aurora, S3), PostgreSQL, Apache Spark, Databricks, ETL',
      'Machine Learning: XGBoost, SHAP, Pandas, NumPy',
      'Developer Tools: Git, Azure DevOps, Docker, Linux/Unix, unit testing, debugging, AI-assisted development',
    ],
  },
];
