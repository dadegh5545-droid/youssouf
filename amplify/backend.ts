import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource.js';
import { data } from './data/resource.js';
import { getMyReport } from './functions/get-my-report/resource.js';

defineBackend({
  auth,
  data,
  getMyReport,
});
