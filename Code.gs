/**

 * Se ejecuta al abrir la aplicación web.

 */

function doGet() {

  return HtmlService.createHtmlOutputFromFile('Index')

      .setTitle('Copiador Drive Pro')

      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)

      .addMetaTag('viewport', 'width=device-width, initial-scale=1');

}



/**

 * Obtiene información de la cuenta y el almacenamiento.

 */

function getDriveStorageInfo() {

  try {

    const user = Session.getActiveUser();

    const email = user.getEmail();

    const storageUsed = DriveApp.getStorageUsed();

    const storageLimit = DriveApp.getStorageLimit();

    

    const isWorkspace = !email.endsWith('@gmail.com');

    const accountType = isWorkspace ? "Workspace" : "Personal";



    return {

      used: (storageUsed / (1024 ** 3)).toFixed(2), // GB

      total: (storageLimit / (1024 ** 3)).toFixed(2), // GB

      limit: storageLimit,

      percent: (storageUsed / storageLimit) * 100,

      accountType: accountType,

      email: email

    };

  } catch (e) {

    return null;

  }

}



/**

 * Verifica los permisos de una URL/ID de carpeta.

 */

function validateFolderPermissions(folderId) {

  if (!folderId || folderId.trim() === "") {

    return { status: "empty" };

  }



  // Extraer ID si es URL

  var cleanId = folderId.trim();

  var match = cleanId.match(/folders\/([a-zA-Z0-9_-]+)/);

  if (match) cleanId = match[1];



  try {

    var folder = DriveApp.getFolderById(cleanId);

    var access = folder.getSharingAccess();

    var permission = folder.getSharingPermission();



    // Caso 1: Acceso Público (Cualquiera con el enlace)

    if (access == DriveApp.Access.ANYONE || access == DriveApp.Access.ANYONE_WITH_LINK) {

      return { status: "public", id: cleanId };

    } 

    

    // Caso 2: Es privado pero yo tengo acceso (Propietario o compartido directamente)

    return { status: "private_with_access", id: cleanId };



  } catch (e) {

    // Caso 3: Es privado y NO tengo acceso (Error al intentar getFolderById)

    return { status: "private_no_access" };

  }

}



/**

 * Verifica si el usuario tiene acceso.

 */

function checkAuth() {

  try {

    var info = getDriveStorageInfo();

    return {

      authenticated: true,

      user: info.email,

      storage: info

    };

  } catch (e) {

    return { authenticated: false };

  }

}



/**

 * Obtiene las subcarpetas de una carpeta específica.

 */

function getChildFolders(parentId) {

  try {

    var parent = (parentId === 'root') ? DriveApp.getRootFolder() : DriveApp.getFolderById(parentId);

    var folders = parent.getFolders();

    var result = [];

    

    while (folders.hasNext()) {

      var folder = folders.next();

      result.push({ id: folder.getId(), name: folder.getName() });

    }

    

    result.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

    return result;

  } catch (e) {

    throw new Error("Error de acceso: " + e.message);

  }

}



/**

 * Función principal para iniciar la copia recursiva.

 */

function copyFiles(sourceId, destId) {

  var cache = CacheService.getUserCache();

  var userKey = Session.getActiveUser().getEmail().replace(/[^a-zA-Z0-9]/g, "");

  var processId = "copy_process_" + userKey;

  

  cache.put(processId, JSON.stringify({

    done: false,

    cancelled: false,

    filesCopied: 0,

    foldersCreated: 0,

    bytesCopied: 0,

    errors: [],

    lastItem: "Iniciando copia..."

  }), 600);

  

  try {

    var cleanSourceId = sourceId.trim();

    var match = cleanSourceId.match(/folders\/([a-zA-Z0-9_-]+)/);

    if (match) cleanSourceId = match[1];



    var sourceFolder = DriveApp.getFolderById(cleanSourceId);

    var destFolder = (destId === 'root') ? DriveApp.getRootFolder() : DriveApp.getFolderById(destId);

    

    var stats = {

      filesCopied: 0,

      foldersCreated: 0,

      bytesCopied: 0,

      errors: []

    };



    recursiveCopy(sourceFolder, destFolder, stats, cache, processId);

    

    var currentStatusStr = cache.get(processId);

    if (!currentStatusStr) return;

    

    var currentStatus = JSON.parse(currentStatusStr);

    if (currentStatus.cancelled) return;



    cache.put(processId, JSON.stringify({

      done: true,

      filesCopied: stats.filesCopied,

      foldersCreated: stats.foldersCreated,

      bytesCopied: stats.bytesCopied,

      errors: stats.errors,

      lastItem: "Proceso completado con éxito"

    }), 600);



  } catch (e) {

    cache.put(processId, JSON.stringify({

      done: true,

      error: true,

      lastItem: "Error crítico: " + e.message,

      errors: [e.message]

    }), 600);

  }

}



/**

 * Copia recursiva con tracking de peso y mensajes detallados para la consola.

 */

function recursiveCopy(sourceFolder, destFolder, stats, cache, processId) {

  var checkCancel = function() {

    var statusStr = cache.get(processId);

    return (statusStr && JSON.parse(statusStr).cancelled);

  };



  if (checkCancel()) return;



  var files = sourceFolder.getFiles();

  while (files.hasNext()) {

    if (checkCancel()) return;

    var file = files.next();

    var fileSize = file.getSize();

    var sizeStr = formatBytes(fileSize);

    

    try {

      file.makeCopy(file.getName(), destFolder);

      stats.filesCopied++;

      stats.bytesCopied += fileSize;

      

      cache.put(processId, JSON.stringify({

        done: false,

        cancelled: false,

        filesCopied: stats.filesCopied,

        foldersCreated: stats.foldersCreated,

        bytesCopied: stats.bytesCopied,

        errors: stats.errors,

        lastItem: "Copiado: " + file.getName() + " (" + sizeStr + ")"

      }), 600);

    } catch (err) {

      stats.errors.push("Error en archivo: " + file.getName());

    }

  }



  var subFolders = sourceFolder.getFolders();

  while (subFolders.hasNext()) {

    if (checkCancel()) return;

    var subFolder = subFolders.next();

    try {

      var newDestFolder = destFolder.createFolder(subFolder.getName());

      stats.foldersCreated++;

      

      cache.put(processId, JSON.stringify({

        done: false,

        cancelled: false,

        filesCopied: stats.filesCopied,

        foldersCreated: stats.foldersCreated,

        bytesCopied: stats.bytesCopied,

        errors: stats.errors,

        lastItem: "Carpeta creada: " + subFolder.getName()

      }), 600);

      

      recursiveCopy(subFolder, newDestFolder, stats, cache, processId);

    } catch (err) {

      stats.errors.push("Error en carpeta: " + subFolder.getName());

    }

  }

}



/**

 * Formatea bytes a una cadena legible.

 */

function formatBytes(bytes) {

  if (bytes === 0) return '0 B';

  const k = 1024;

  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];

}



/**

 * Cancela la operación actual marcando el estado en el cache.

 */

function cancelCopy() {

  var cache = CacheService.getUserCache();

  var userKey = Session.getActiveUser().getEmail().replace(/[^a-zA-Z0-9]/g, "");

  var processId = "copy_process_" + userKey;

  var data = cache.get(processId);

  if (data) {

    var status = JSON.parse(data);

    status.cancelled = true;

    status.done = true;

    cache.put(processId, JSON.stringify(status), 600);

  }

}



/**

 * Obtiene el progreso actual desde el cache.

 */

function getProgress() {

  var cache = CacheService.getUserCache();

  var userKey = Session.getActiveUser().getEmail().replace(/[^a-zA-Z0-9]/g, "");

  var processId = "copy_process_" + userKey;

  var data = cache.get(processId);

  return data ? JSON.parse(data) : null;

}
