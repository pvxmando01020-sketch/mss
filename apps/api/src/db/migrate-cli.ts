import 'dotenv/config';
import { runMigrations } from './migrate';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
runMigrations(url)
  .then(() => {
    console.log('migrations complete');
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
