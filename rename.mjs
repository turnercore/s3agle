import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const directory = './test_files';

fs.readdir(directory, (err, files) => {
  if (err) {
    return console.error('Unable to scan directory: ' + err);
  }

  files.forEach((file) => {
    const uniqueName = uuidv4();
    const fileExtension = path.extname(file);
    const newName = uniqueName + fileExtension;
    const oldFilePath = path.join(directory, file);
    const newFilePath = path.join(directory, newName);

    fs.rename(oldFilePath, newFilePath, (err) => {
      if (err) {
        console.error('Error renaming file: ' + err);
      }
    });
  });

  console.error('Files have been renamed.');
});
