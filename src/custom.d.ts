declare namespace Express {
   interface Request {
      userPermission?: import("./security").UserPermission;
   }
}