import type { RequestHandler } from "express";
import type { CategoryApi } from "../services/category.service.js";

export const createListCategories = (categories: CategoryApi): RequestHandler =>
  async (_request, response, next) => {
    try {
      response.status(200).json({ categories: await categories.listActive() });
    } catch (error) {
      next(error);
    }
  };
