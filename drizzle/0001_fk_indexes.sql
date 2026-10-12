CREATE INDEX "activities_user_id_index" ON "activities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "card_label_label_id_index" ON "card_label" USING btree ("label_id");--> statement-breakpoint
CREATE INDEX "cards_created_by_index" ON "cards" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "comments_user_id_index" ON "comments" USING btree ("user_id");