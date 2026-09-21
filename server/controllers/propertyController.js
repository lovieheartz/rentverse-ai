'use strict';

const asyncErrorHandler = require('../middlewares/helpers/asyncErrorHandler');
const ApiError = require('../utils/apiError');
const { sendSuccess } = require('../utils/apiResponse');
const propertyService = require('../services/propertyService');

/**
 * Property catalogue endpoints.
 *
 * Controllers stay thin on purpose: validation happens in middleware, query logic lives
 * in `propertyService`, and failures are thrown for the central error handler. That keeps
 * the interesting logic in pure, testable functions.
 */

/** `GET /api/properties` */
exports.listProperties = asyncErrorHandler(async (req, res) => {
  const query = req.validated.query;

  // Cross-field rules the per-field schema cannot express.
  const rangeErrors = [];
  if (
    query.minPriceUsd !== undefined &&
    query.maxPriceUsd !== undefined &&
    query.minPriceUsd > query.maxPriceUsd
  ) {
    rangeErrors.push({
      field: 'minPriceUsd',
      code: 'out_of_range',
      message: 'minPriceUsd must be less than or equal to maxPriceUsd.',
    });
  }
  if (query.minRoiPct !== undefined && query.maxRoiPct !== undefined && query.minRoiPct > query.maxRoiPct) {
    rangeErrors.push({
      field: 'minRoiPct',
      code: 'out_of_range',
      message: 'minRoiPct must be less than or equal to maxRoiPct.',
    });
  }
  if (rangeErrors.length > 0) throw ApiError.validationFailed(rangeErrors);

  const { items, pagination, appliedFilters } = propertyService.listProperties(query);

  return sendSuccess(res, items, { meta: { pagination, appliedFilters } });
});

/** `GET /api/properties/featured` */
exports.listFeaturedProperties = asyncErrorHandler(async (req, res) => {
  const { limit } = req.validated.query;
  const items = propertyService.getFeaturedProperties(limit);

  return sendSuccess(res, items, { meta: { count: items.length, limit } });
});

/** `GET /api/properties/:id` */
exports.getPropertyDetails = asyncErrorHandler(async (req, res) => {
  const { id } = req.validated.params;
  const property = propertyService.getPropertyById(id);

  if (!property) {
    throw ApiError.notFound(`No property exists with id "${id}".`, { propertyId: id });
  }

  return sendSuccess(res, property);
});
